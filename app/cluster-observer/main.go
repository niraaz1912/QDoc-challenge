package main

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const saDir = "/var/run/secrets/kubernetes.io/serviceaccount"

type collection struct {
	path  string
	items map[string]json.RawMessage
}

type observer struct {
	client      *http.Client
	base        string
	mu          sync.RWMutex
	resources   map[string]*collection
	nodeMetrics map[string]metricUsage
	podMetrics  map[string]metricUsage
	subscribers map[chan []byte]struct{}
	sequence    uint64
}

type metricUsage struct {
	CPU    float64
	Memory float64
}
type meta struct {
	Name            string            `json:"name"`
	Namespace       string            `json:"namespace"`
	Labels          map[string]string `json:"labels"`
	OwnerReferences []struct {
		Kind string `json:"kind"`
		Name string `json:"name"`
	} `json:"ownerReferences"`
}
type rawNode struct {
	Metadata meta `json:"metadata"`
	Status   struct {
		Allocatable map[string]string `json:"allocatable"`
		Conditions  []struct {
			Type   string `json:"type"`
			Status string `json:"status"`
		} `json:"conditions"`
	} `json:"status"`
}
type rawPod struct {
	Metadata meta `json:"metadata"`
	Spec     struct {
		NodeName string `json:"nodeName"`
	} `json:"spec"`
	Status struct {
		Phase      string `json:"phase"`
		Conditions []struct {
			Type   string `json:"type"`
			Status string `json:"status"`
		} `json:"conditions"`
		ContainerStatuses []struct {
			RestartCount int `json:"restartCount"`
			State        struct {
				Waiting *struct {
					Reason string `json:"reason"`
				} `json:"waiting"`
			} `json:"state"`
		} `json:"containerStatuses"`
	} `json:"status"`
}
type rawService struct {
	Metadata meta `json:"metadata"`
	Spec     struct {
		Type     string            `json:"type"`
		Selector map[string]string `json:"selector"`
	} `json:"spec"`
}
type rawEndpointSlice struct {
	Metadata  meta `json:"metadata"`
	Endpoints []struct {
		TargetRef *struct {
			Kind      string `json:"kind"`
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"targetRef"`
	} `json:"endpoints"`
}
type rawDeployment struct {
	Metadata meta `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status struct {
		AvailableReplicas int `json:"availableReplicas"`
	} `json:"status"`
}
type nodeView struct {
	Name          string   `json:"name"`
	Ready         bool     `json:"ready"`
	CPUPercent    *float64 `json:"cpuPercent"`
	MemoryPercent *float64 `json:"memoryPercent"`
}
type podView struct {
	ID        string   `json:"id"`
	Namespace string   `json:"namespace"`
	Name      string   `json:"name"`
	Node      string   `json:"node"`
	Phase     string   `json:"phase"`
	Reason    string   `json:"reason"`
	Restarts  int      `json:"restarts"`
	CPUm      *float64 `json:"cpuMillicores"`
	MemoryMiB *float64 `json:"memoryMiB"`
}
type serviceView struct {
	ID        string   `json:"id"`
	Namespace string   `json:"namespace"`
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	PodIDs    []string `json:"podIds"`
}
type deploymentView struct {
	ID        string `json:"id"`
	Desired   int    `json:"desired"`
	Available int    `json:"available"`
}
type snapshot struct {
	Type        string           `json:"type"`
	Sequence    uint64           `json:"sequence"`
	At          time.Time        `json:"at"`
	Nodes       []nodeView       `json:"nodes"`
	Pods        []podView        `json:"pods"`
	Services    []serviceView    `json:"services"`
	Deployments []deploymentView `json:"deployments"`
}

func main() {
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	if host == "" {
		log.Fatal("KUBERNETES_SERVICE_HOST is missing")
	}
	port := os.Getenv("KUBERNETES_SERVICE_PORT_HTTPS")
	if port == "" {
		port = "443"
	}
	ca, err := os.ReadFile(saDir + "/ca.crt")
	if err != nil {
		log.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		log.Fatal("invalid Kubernetes CA")
	}
	o := &observer{
		client: &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}},
		base:   "https://" + host + ":" + port,
		resources: map[string]*collection{
			"nodes":          {path: "/api/v1/nodes", items: make(map[string]json.RawMessage)},
			"pods":           {path: "/api/v1/pods", items: make(map[string]json.RawMessage)},
			"services":       {path: "/api/v1/services", items: make(map[string]json.RawMessage)},
			"endpointslices": {path: "/apis/discovery.k8s.io/v1/endpointslices", items: make(map[string]json.RawMessage)},
			"deployments":    {path: "/apis/apps/v1/deployments", items: make(map[string]json.RawMessage)},
		},
		nodeMetrics: make(map[string]metricUsage), podMetrics: make(map[string]metricUsage),
		subscribers: make(map[chan []byte]struct{}),
	}
	for name, c := range o.resources {
		go o.watchForever(name, c)
	}
	go o.pollMetrics()
	go o.publishLoop()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/ws", o.serveWebSocket)
	server := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(server.ListenAndServe())
}

func (o *observer) request(ctx context.Context, path string, q url.Values) (*http.Response, error) {
	token, err := os.ReadFile(saDir + "/token")
	if err != nil {
		return nil, err
	}
	u := o.base + path
	if q != nil {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	return o.client.Do(req)
}

func (o *observer) watchForever(name string, c *collection) {
	for {
		if err := o.listAndWatch(name, c); err != nil {
			log.Printf("%s watch: %v", name, err)
		}
		time.Sleep(2 * time.Second)
	}
}

func (o *observer) listAndWatch(name string, c *collection) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	resp, err := o.request(ctx, c.path, nil)
	if err != nil {
		cancel()
		return err
	}
	if resp.StatusCode != http.StatusOK {
		err = fmt.Errorf("list returned %s", resp.Status)
		resp.Body.Close()
		cancel()
		return err
	}
	var listing struct {
		Metadata struct {
			ResourceVersion string `json:"resourceVersion"`
		} `json:"metadata"`
		Items []json.RawMessage `json:"items"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&listing)
	resp.Body.Close()
	cancel()
	if err != nil {
		return err
	}
	items := make(map[string]json.RawMessage, len(listing.Items))
	for _, raw := range listing.Items {
		if key := objectKey(raw); key != "" {
			items[key] = raw
		}
	}
	o.mu.Lock()
	c.items = items
	o.sequence++
	o.mu.Unlock()

	q := url.Values{"watch": {"true"}, "allowWatchBookmarks": {"true"}, "resourceVersion": {listing.Metadata.ResourceVersion}, "timeoutSeconds": {"300"}}
	ctx, cancel = context.WithTimeout(context.Background(), 310*time.Second)
	defer cancel()
	resp, err = o.request(ctx, c.path, q)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("watch returned %s", resp.Status)
	}
	dec := json.NewDecoder(resp.Body)
	for {
		var event struct {
			Type   string          `json:"type"`
			Object json.RawMessage `json:"object"`
		}
		if err := dec.Decode(&event); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		if event.Type == "ERROR" {
			return fmt.Errorf("%s watch error; relisting", name)
		}
		key := objectKey(event.Object)
		if key == "" {
			continue
		}
		o.mu.Lock()
		switch event.Type {
		case "ADDED", "MODIFIED":
			c.items[key] = event.Object
			o.sequence++
		case "DELETED":
			delete(c.items, key)
			o.sequence++
		}
		o.mu.Unlock()
	}
}

func objectKey(raw json.RawMessage) string {
	var obj struct {
		Metadata meta `json:"metadata"`
	}
	if json.Unmarshal(raw, &obj) != nil || obj.Metadata.Name == "" {
		return ""
	}
	return obj.Metadata.Namespace + "/" + obj.Metadata.Name
}

func (o *observer) pollMetrics() {
	for {
		nodes := o.fetchMetrics("/apis/metrics.k8s.io/v1beta1/nodes", false)
		pods := o.fetchMetrics("/apis/metrics.k8s.io/v1beta1/pods", true)
		o.mu.Lock()
		o.nodeMetrics = nodes
		o.podMetrics = pods
		o.sequence++
		o.mu.Unlock()
		time.Sleep(15 * time.Second)
	}
}

func (o *observer) fetchMetrics(path string, isPod bool) map[string]metricUsage {
	result := make(map[string]metricUsage)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	resp, err := o.request(ctx, path, nil)
	if err != nil {
		log.Printf("metrics: %v", err)
		return result
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("metrics %s: %s", path, resp.Status)
		return result
	}
	var body struct {
		Items []struct {
			Metadata   meta              `json:"metadata"`
			Usage      map[string]string `json:"usage"`
			Containers []struct {
				Usage map[string]string `json:"usage"`
			} `json:"containers"`
		} `json:"items"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&body) != nil {
		return result
	}
	for _, item := range body.Items {
		usage := metricUsage{CPU: cpuCores(item.Usage["cpu"]), Memory: bytesValue(item.Usage["memory"])}
		if isPod {
			for _, c := range item.Containers {
				usage.CPU += cpuCores(c.Usage["cpu"])
				usage.Memory += bytesValue(c.Usage["memory"])
			}
		}
		key := item.Metadata.Name
		if isPod {
			key = item.Metadata.Namespace + "/" + key
		}
		result[key] = usage
	}
	return result
}

func cpuCores(s string) float64 {
	return quantity(s, map[string]float64{"n": 1e-9, "u": 1e-6, "m": 1e-3})
}
func bytesValue(s string) float64 {
	return quantity(s, map[string]float64{"Ki": 1024, "Mi": 1024 * 1024, "Gi": 1024 * 1024 * 1024, "K": 1000, "M": 1e6, "G": 1e9})
}
func quantity(s string, suffixes map[string]float64) float64 {
	for suffix, factor := range suffixes {
		if strings.HasSuffix(s, suffix) {
			n, _ := strconv.ParseFloat(strings.TrimSuffix(s, suffix), 64)
			return n * factor
		}
	}
	n, _ := strconv.ParseFloat(s, 64)
	return n
}
func percent(used, total float64) *float64 {
	if total <= 0 {
		return nil
	}
	n := math.Round(used/total*1000) / 10
	return &n
}

func (o *observer) makeSnapshot() []byte {
	o.mu.RLock()
	defer o.mu.RUnlock()
	s := snapshot{Type: "snapshot", Sequence: o.sequence, At: time.Now().UTC(), Nodes: []nodeView{}, Pods: []podView{}, Services: []serviceView{}, Deployments: []deploymentView{}}
	servicePods := make(map[string]map[string]struct{})
	for _, raw := range o.resources["endpointslices"].items {
		var slice rawEndpointSlice
		if json.Unmarshal(raw, &slice) != nil {
			continue
		}
		serviceName := slice.Metadata.Labels["kubernetes.io/service-name"]
		if serviceName == "" {
			continue
		}
		serviceID := slice.Metadata.Namespace + "/" + serviceName
		if servicePods[serviceID] == nil {
			servicePods[serviceID] = make(map[string]struct{})
		}
		for _, endpoint := range slice.Endpoints {
			if endpoint.TargetRef == nil || endpoint.TargetRef.Kind != "Pod" {
				continue
			}
			namespace := endpoint.TargetRef.Namespace
			if namespace == "" {
				namespace = slice.Metadata.Namespace
			}
			servicePods[serviceID][namespace+"/"+endpoint.TargetRef.Name] = struct{}{}
		}
	}
	for _, raw := range o.resources["nodes"].items {
		var n rawNode
		if json.Unmarshal(raw, &n) != nil {
			continue
		}
		view := nodeView{Name: n.Metadata.Name}
		for _, c := range n.Status.Conditions {
			if c.Type == "Ready" {
				view.Ready = c.Status == "True"
			}
		}
		if m, ok := o.nodeMetrics[n.Metadata.Name]; ok {
			view.CPUPercent = percent(m.CPU, cpuCores(n.Status.Allocatable["cpu"]))
			view.MemoryPercent = percent(m.Memory, bytesValue(n.Status.Allocatable["memory"]))
		}
		s.Nodes = append(s.Nodes, view)
	}
	for _, raw := range o.resources["pods"].items {
		var p rawPod
		if json.Unmarshal(raw, &p) != nil {
			continue
		}
		id := p.Metadata.Namespace + "/" + p.Metadata.Name
		view := podView{ID: id, Namespace: p.Metadata.Namespace, Name: p.Metadata.Name, Node: p.Spec.NodeName, Phase: p.Status.Phase}
		if view.Phase == "" {
			view.Phase = "Unknown"
		}
		for _, c := range p.Status.Conditions {
			if c.Type == "Ready" && c.Status != "True" && view.Phase == "Running" {
				view.Reason = "NotReady"
			}
		}
		for _, c := range p.Status.ContainerStatuses {
			view.Restarts += c.RestartCount
			if c.State.Waiting != nil && c.State.Waiting.Reason != "" {
				view.Reason = c.State.Waiting.Reason
			}
		}
		if m, ok := o.podMetrics[id]; ok {
			cpu := math.Round(m.CPU*1000*10) / 10
			mem := math.Round(m.Memory/1024/1024*10) / 10
			view.CPUm = &cpu
			view.MemoryMiB = &mem
		}
		s.Pods = append(s.Pods, view)
	}
	for _, raw := range o.resources["services"].items {
		var svc rawService
		if json.Unmarshal(raw, &svc) != nil {
			continue
		}
		view := serviceView{ID: svc.Metadata.Namespace + "/" + svc.Metadata.Name, Namespace: svc.Metadata.Namespace, Name: svc.Metadata.Name, Type: svc.Spec.Type, PodIDs: []string{}}
		for id := range servicePods[view.ID] {
			view.PodIDs = append(view.PodIDs, id)
		}
		sort.Strings(view.PodIDs)
		s.Services = append(s.Services, view)
	}
	for _, raw := range o.resources["deployments"].items {
		var d rawDeployment
		if json.Unmarshal(raw, &d) != nil {
			continue
		}
		desired := 1
		if d.Spec.Replicas != nil {
			desired = *d.Spec.Replicas
		}
		s.Deployments = append(s.Deployments, deploymentView{ID: d.Metadata.Namespace + "/" + d.Metadata.Name, Desired: desired, Available: d.Status.AvailableReplicas})
	}
	sort.Slice(s.Nodes, func(i, j int) bool { return s.Nodes[i].Name < s.Nodes[j].Name })
	sort.Slice(s.Pods, func(i, j int) bool { return s.Pods[i].ID < s.Pods[j].ID })
	sort.Slice(s.Services, func(i, j int) bool { return s.Services[i].ID < s.Services[j].ID })
	sort.Slice(s.Deployments, func(i, j int) bool { return s.Deployments[i].ID < s.Deployments[j].ID })
	data, err := json.Marshal(s)
	if err != nil {
		log.Printf("snapshot marshal: %v", err)
		return nil
	}
	return data
}

func (o *observer) publishLoop() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	var last uint64
	for range ticker.C {
		o.mu.RLock()
		seq := o.sequence
		o.mu.RUnlock()
		if seq == last {
			continue
		}
		last = seq
		data := o.makeSnapshot()
		if data == nil {
			continue
		}
		o.mu.Lock()
		for ch := range o.subscribers {
			select {
			case ch <- data:
			default:
			}
		}
		o.mu.Unlock()
	}
}

var upgrader = websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 8192}

func (o *observer) serveWebSocket(w http.ResponseWriter, r *http.Request) {
	sharedToken := os.Getenv("CLUSTER_OBSERVER_TOKEN")
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if sharedToken == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(sharedToken)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	ch := make(chan []byte, 1)
	o.mu.Lock()
	o.subscribers[ch] = struct{}{}
	o.mu.Unlock()
	defer func() { o.mu.Lock(); delete(o.subscribers, ch); o.mu.Unlock() }()
	if data := o.makeSnapshot(); data != nil {
		ch <- data
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case data := <-ch:
			_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-heartbeat.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}
