import { useRef, useEffect, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useChatStore } from "../../stores/chat";
import { Network } from "lucide-react";

export function GraphVisualization() {
  const agemState = useChatStore((s) => s.agemState);
  const graphSummary = agemState?.graph_summary;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        setDimensions({ width, height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const hasData = graphSummary && graphSummary.nodes.length > 0;

  return (
    <div className="graph-viz" ref={containerRef} style={{ width: "100%", height: "100%", minHeight: "300px" }}>
      {!hasData ? (
        <div className="graph-viz__empty">
          <Network size={48} className="graph-viz__empty-icon" />
          <div className="graph-viz__empty-text">
            No graph data available. Start an orchestration cycle to see the semantic network.
          </div>
        </div>
      ) : dimensions.width > 0 && dimensions.height > 0 ? (
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height}
          graphData={{
            nodes: graphSummary.nodes.map((n) => ({ ...n })),
            links: graphSummary.edges.map((e) => ({ ...e })),
          }}
          nodeLabel="label"
          nodeAutoColorBy="community"
          linkColor={() => "rgba(255, 255, 255, 0.2)"}
          backgroundColor="transparent"
          nodeRelSize={6}
          linkWidth={(link: any) => link.weight ? Math.sqrt(link.weight) : 1}
        />
      ) : null}
    </div>
  );
}
