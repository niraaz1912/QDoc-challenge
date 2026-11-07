package main

import (
	"encoding/json"
	"testing"
)

func TestSnapshotUsesLiveEndpointSlicesAndReportsCrashLoop(t *testing.T) {
	o := &observer{
		resources: map[string]*collection{
			"nodes":          {items: map[string]json.RawMessage{"/node-a": json.RawMessage(`{"metadata":{"name":"node-a"},"status":{"allocatable":{"cpu":"4","memory":"16Gi"},"conditions":[{"type":"Ready","status":"True"}]}}`)}},
			"pods":           {items: map[string]json.RawMessage{"qdoc/api-1": json.RawMessage(`{"metadata":{"namespace":"qdoc","name":"api-1"},"spec":{"nodeName":"node-a"},"status":{"phase":"Running","containerStatuses":[{"restartCount":3,"state":{"waiting":{"reason":"CrashLoopBackOff"}}}]}}`)}},
			"services":       {items: map[string]json.RawMessage{"qdoc/api": json.RawMessage(`{"metadata":{"namespace":"qdoc","name":"api"},"spec":{"type":"ClusterIP"}}`)}},
			"endpointslices": {items: map[string]json.RawMessage{"qdoc/api-abc": json.RawMessage(`{"metadata":{"namespace":"qdoc","name":"api-abc","labels":{"kubernetes.io/service-name":"api"}},"endpoints":[{"targetRef":{"kind":"Pod","name":"api-1"}}]}`)}},
			"deployments":    {items: map[string]json.RawMessage{}},
		},
		nodeMetrics: map[string]metricUsage{"node-a": {CPU: 2, Memory: 8 * 1024 * 1024 * 1024}},
		podMetrics:  map[string]metricUsage{},
	}
	var got snapshot
	if err := json.Unmarshal(o.makeSnapshot(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Nodes) != 1 || got.Nodes[0].CPUPercent == nil || *got.Nodes[0].CPUPercent != 50 {
		t.Fatalf("unexpected node metrics: %+v", got.Nodes)
	}
	if len(got.Pods) != 1 || got.Pods[0].Reason != "CrashLoopBackOff" || got.Pods[0].Restarts != 3 {
		t.Fatalf("unexpected pod health: %+v", got.Pods)
	}
	if len(got.Services) != 1 || len(got.Services[0].PodIDs) != 1 || got.Services[0].PodIDs[0] != "qdoc/api-1" {
		t.Fatalf("unexpected service topology: %+v", got.Services)
	}
}
