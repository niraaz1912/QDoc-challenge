import { useEffect, useMemo, useRef, useState } from "react";
import { useAuthContext } from "../../context/AuthContext";
import "./ClusterLive.css";

const empty = { nodes: [], pods: [], services: [], deployments: [], at: null, sequence: 0 };

function healthOfPod(pod) {
  if (["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError"].includes(pod.reason) || pod.phase === "Failed") return "danger";
  if (pod.phase !== "Running" || pod.reason) return "warning";
  return "healthy";
}

function heatClass(value) {
  if (value == null) return "unknown";
  if (value >= 85) return "hot";
  if (value >= 65) return "warm";
  return "cool";
}

function Usage({ label, value }) {
  return <div className="cluster-usage">
    <span>{label}</span>
    <div className="cluster-usage-track"><div className={`cluster-usage-fill ${heatClass(value)}`} style={{ width: `${Math.min(value ?? 0, 100)}%` }} /></div>
    <strong>{value == null ? "—" : `${value}%`}</strong>
  </div>;
}

export default function ClusterLive() {
  const { user } = useAuthContext();
  const [allowed, setAllowed] = useState(null);
  const [snapshot, setSnapshot] = useState(empty);
  const [connection, setConnection] = useState("connecting");
  const [namespace, setNamespace] = useState("qdoc");
  const [selected, setSelected] = useState(null);
  const [edges, setEdges] = useState([]);
  const boardRef = useRef(null);

  useEffect(() => {
    let live = true;
    user?.getIdTokenResult().then((result) => {
      if (live) setAllowed(result.claims.clusterViewer === true);
    }).catch(() => { if (live) setAllowed(false); });
    return () => { live = false; };
  }, [user]);

  useEffect(() => {
    if (!allowed || !user) return undefined;
    let socket;
    let retry;
    let active = true;
    async function connect() {
      setConnection("connecting");
      try {
        const token = await user.getIdToken();
        if (!active) return;
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${location.host}/api/cluster/ws`);
        socket.onopen = () => socket.send(JSON.stringify({ token }));
        socket.onmessage = (event) => {
          try {
            const next = JSON.parse(event.data);
            if (next.type === "snapshot") { setSnapshot(next); setConnection("live"); }
          } catch { setConnection("error"); }
        };
        socket.onclose = (event) => {
          if (!active) return;
          if (event.code === 1008) { setAllowed(false); return; }
          setConnection("reconnecting");
          retry = setTimeout(connect, 3000);
        };
        socket.onerror = () => setConnection("reconnecting");
      } catch {
        if (active) { setConnection("reconnecting"); retry = setTimeout(connect, 3000); }
      }
    }
    connect();
    return () => { active = false; clearTimeout(retry); socket?.close(); };
  }, [allowed, user]);

  const namespaces = useMemo(() => ["all", ...new Set([...snapshot.pods, ...snapshot.services].map((r) => r.namespace))].sort((a, b) => a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b)), [snapshot]);
  const visiblePods = useMemo(() => snapshot.pods.filter((p) => namespace === "all" || p.namespace === namespace), [snapshot, namespace]);
  const visibleServices = useMemo(() => snapshot.services.filter((s) => namespace === "all" || s.namespace === namespace), [snapshot, namespace]);
  const visibleIds = useMemo(() => new Set(visiblePods.map((p) => p.id)), [visiblePods]);
  const counts = useMemo(() => ({ failed: visiblePods.filter((p) => healthOfPod(p) === "danger").length, warning: visiblePods.filter((p) => healthOfPod(p) === "warning").length }), [visiblePods]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return undefined;
    const redraw = () => {
      const bounds = board.getBoundingClientRect();
      const lines = [];
      for (const service of visibleServices) {
        const start = board.querySelector(`[data-service-id="${CSS.escape(service.id)}"]`);
        if (!start) continue;
        const a = start.getBoundingClientRect();
        for (const id of service.podIds) {
          if (!visibleIds.has(id)) continue;
          const end = board.querySelector(`[data-pod-id="${CSS.escape(id)}"]`);
          if (!end) continue;
          const b = end.getBoundingClientRect();
          lines.push({ id: `${service.id}:${id}`, x1: a.right - bounds.left, y1: a.top + a.height / 2 - bounds.top, x2: b.left - bounds.left, y2: b.top + b.height / 2 - bounds.top });
        }
      }
      setEdges(lines);
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(board);
    window.addEventListener("resize", redraw);
    return () => { observer.disconnect(); window.removeEventListener("resize", redraw); };
  }, [visibleServices, visiblePods, visibleIds, snapshot.nodes]);

  if (allowed === null) return <main className="cluster-page"><p>Checking cluster access…</p></main>;
  if (!allowed) return <main className="cluster-page"><div className="cluster-denied"><h1>Cluster access required</h1><p>This page is available only to accounts with the Firebase <code>clusterViewer</code> claim.</p></div></main>;

  const inspect = selected?.kind === "node" ? snapshot.nodes.find((x) => x.name === selected.id)
    : selected?.kind === "pod" ? snapshot.pods.find((x) => x.id === selected.id)
    : selected?.kind === "service" ? snapshot.services.find((x) => x.id === selected.id)
    : snapshot.deployments.find((x) => x.id === selected?.id);

  return <main className="cluster-page">
    <header className="cluster-header">
      <div><div className="cluster-eyebrow">QDOC / OPERATIONS</div><h1>Cluster map</h1><p>One view of the workloads running in AKS.</p></div>
      <div className="cluster-header-right"><span className={`cluster-connection ${connection}`}><i />{connection}</span><small>{snapshot.at ? `Updated ${new Date(snapshot.at).toLocaleTimeString()}` : "Waiting for cluster data"}</small></div>
    </header>

    <div className="cluster-stats">
      <div><strong>{snapshot.nodes.length}</strong><span>Nodes</span></div>
      <div><strong>{visiblePods.length}</strong><span>Pods</span></div>
      <div><strong>{visibleServices.length}</strong><span>Services</span></div>
      <div className="danger"><strong>{counts.failed}</strong><span>Failed / crash loops</span></div>
      <div className="warning"><strong>{counts.warning}</strong><span>Pending / not ready</span></div>
    </div>

    <div className="cluster-toolbar"><label htmlFor="cluster-namespace">Namespace</label><select id="cluster-namespace" value={namespace} onChange={(e) => setNamespace(e.target.value)}>{namespaces.map((ns) => <option key={ns} value={ns}>{ns === "all" ? "All namespaces" : ns}</option>)}</select><span>Resource updates live / CPU and memory every 15s</span></div>

    <div className="cluster-board" ref={boardRef}>
      <svg className="cluster-links" aria-hidden="true">{edges.map((e) => <path key={e.id} d={`M ${e.x1} ${e.y1} C ${e.x1 + 80} ${e.y1}, ${e.x2 - 80} ${e.y2}, ${e.x2} ${e.y2}`} />)}</svg>
      <section className="cluster-services"><h2>Services</h2>{visibleServices.map((s) => <button key={s.id} type="button" className={`cluster-service ${selected?.id === s.id ? "selected" : ""}`} data-service-id={s.id} onClick={() => setSelected({ kind: "service", id: s.id })}><span>{s.name}</span><small>{s.namespace} · {s.type} · {s.podIds.length} endpoints</small></button>)}{!visibleServices.length && <p className="cluster-muted">No services in this namespace.</p>}</section>
      <section className="cluster-nodes"><h2>Nodes and pods</h2>{snapshot.nodes.map((node) => <div key={node.name} className={`cluster-node ${heatClass(Math.max(node.cpuPercent ?? 0, node.memoryPercent ?? 0))}`}><button type="button" className="cluster-node-title" onClick={() => setSelected({ kind: "node", id: node.name })}><span className={`cluster-dot ${node.ready ? "healthy" : "danger"}`} /> <strong>{node.name}</strong><small>{node.ready ? "Ready" : "Not ready"}</small></button><div className="cluster-node-usage"><Usage label="CPU" value={node.cpuPercent}/><Usage label="RAM" value={node.memoryPercent}/></div><div className="cluster-pods">{visiblePods.filter((p) => p.node === node.name).map((pod) => <button type="button" key={pod.id} className={`cluster-pod ${healthOfPod(pod)} ${selected?.id === pod.id ? "selected" : ""}`} data-pod-id={pod.id} onClick={() => setSelected({ kind: "pod", id: pod.id })}><span className={`cluster-dot ${healthOfPod(pod)}`} /><span className="cluster-pod-name">{pod.name}</span><small>{pod.namespace}</small></button>)}</div></div>)}{visiblePods.some((p) => !p.node) && <div className="cluster-node unassigned"><h3>Unscheduled pods</h3><div className="cluster-pods">{visiblePods.filter((p) => !p.node).map((pod) => <button type="button" key={pod.id} className={`cluster-pod ${healthOfPod(pod)}`} data-pod-id={pod.id} onClick={() => setSelected({ kind: "pod", id: pod.id })}>{pod.name}</button>)}</div></div>}</section>
      <aside className="cluster-inspector"><h2>Inspector</h2>{inspect ? <><div className="cluster-inspector-kind">{selected.kind}</div><h3>{selected.id}</h3><dl>{Object.entries(inspect).filter(([key]) => key !== "id" && key !== "podIds").map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value == null ? "—" : String(value)}</dd></div>)}</dl>{inspect.podIds && <><h4>Connected pods</h4><ul>{inspect.podIds.map((id) => <li key={id}>{id}</li>)}</ul></>}</> : <p className="cluster-muted">Click a node, pod, or service to inspect its live state.</p>}<div className="cluster-workloads"><h3>Deployments</h3>{snapshot.deployments.filter((d) => namespace === "all" || d.id.startsWith(`${namespace}/`)).map((d) => <button type="button" key={d.id} onClick={() => setSelected({ kind: "deployment", id: d.id })}><span>{d.id}</span><strong className={d.available < d.desired ? "bad" : "good"}>{d.available}/{d.desired}</strong></button>)}</div></aside>
    </div>
  </main>;
}
