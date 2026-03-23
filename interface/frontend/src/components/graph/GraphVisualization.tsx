import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useChatStore } from "../../stores/chat";
import { useAgemStore } from "../../stores/agem";
import { Network, Layers, Grid3X3 } from "lucide-react";

type ViewMode = "concepts" | "words";

/** Color palette for communities. */
const COMMUNITY_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#e11d48", "#a855f7", "#22c55e", "#eab308",
];

function getCommunityColor(id: number): string {
  return COMMUNITY_COLORS[id % COMMUNITY_COLORS.length]!;
}

export function GraphVisualization() {
  const agemStoreState = useAgemStore((s) => s.state);
  const chatStoreState = useChatStore((s) => s.agemState);
  const graphSummary = agemStoreState?.graph_summary ?? chatStoreState?.graph_summary;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [viewMode, setViewMode] = useState<ViewMode>("concepts");
  const fgRef = useRef<any>(null);

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

  // Build concept-level graph data from concept_graph summary
  const conceptGraphData = useMemo(() => {
    const cg = graphSummary?.concept_graph;
    if (!cg || cg.communities.length === 0) return null;

    const nodes = cg.communities.map((c) => ({
      id: `c-${c.id}`,
      label: c.label,
      size: c.size,
      community: c.id,
      members: c.members,
      internal_weight: c.internal_weight,
      val: Math.max(4, Math.sqrt(c.size) * 3),
    }));

    const links = cg.edges.map((e) => ({
      source: `c-${e.source}`,
      target: `c-${e.target}`,
      edgeCount: e.edge_count,
      totalWeight: e.total_weight,
    }));

    return { nodes, links };
  }, [graphSummary?.concept_graph]);

  // Word-level graph data (existing behavior)
  const wordGraphData = useMemo(() => {
    if (!graphSummary || graphSummary.nodes.length === 0) return null;
    return {
      nodes: graphSummary.nodes.map((n) => ({ ...n })),
      links: graphSummary.edges.map((e) => ({ ...e })),
    };
  }, [graphSummary]);

  // Custom node renderer for concept view
  const drawConceptNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label = node.label as string;
    const size = (node.val as number) ?? 6;
    const color = getCommunityColor(node.community ?? 0);
    const x = node.x as number;
    const y = node.y as number;

    // Draw circle
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    ctx.fillStyle = color + "40"; // semi-transparent fill
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();

    // Draw label (split multi-word labels)
    const fontSize = Math.max(10 / globalScale, 2);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e2e8f0";

    // Split label by " · " and render each word on a separate line
    const parts = label.split(" · ");
    const lineHeight = fontSize * 1.3;
    const startY = y - ((parts.length - 1) * lineHeight) / 2;
    for (let i = 0; i < parts.length; i++) {
      ctx.fillText(parts[i]!, x, startY + i * lineHeight);
    }

    // Draw member count below
    const countFontSize = Math.max(7 / globalScale, 1.5);
    ctx.font = `${countFontSize}px sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(
      `(${node.size ?? 0} nodes)`,
      x,
      startY + parts.length * lineHeight,
    );
  }, []);

  const hasData = graphSummary && graphSummary.nodes.length > 0;
  const hasConcepts = conceptGraphData && conceptGraphData.nodes.length > 0;

  // Auto-select concept view when available
  const activeData = viewMode === "concepts" && hasConcepts
    ? conceptGraphData
    : wordGraphData;

  return (
    <div
      className="graph-viz"
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: "300px", position: "relative" }}
    >
      {/* View toggle */}
      {hasData && hasConcepts && (
        <div style={{
          position: "absolute", top: 8, right: 8, zIndex: 10,
          display: "flex", gap: 4, background: "rgba(0,0,0,0.6)",
          borderRadius: 6, padding: 3,
        }}>
          <button
            onClick={() => setViewMode("concepts")}
            title="Concept communities"
            style={{
              background: viewMode === "concepts" ? "rgba(59,130,246,0.3)" : "transparent",
              border: viewMode === "concepts" ? "1px solid rgba(59,130,246,0.5)" : "1px solid transparent",
              borderRadius: 4, padding: "4px 8px", cursor: "pointer",
              color: viewMode === "concepts" ? "#93c5fd" : "#64748b",
              display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem",
            }}
          >
            <Layers size={12} /> Concepts
          </button>

          <button
            onClick={() => setViewMode("words")}
            title="Individual word nodes"
            style={{
              background: viewMode === "words" ? "rgba(59,130,246,0.3)" : "transparent",
              border: viewMode === "words" ? "1px solid rgba(59,130,246,0.5)" : "1px solid transparent",
              borderRadius: 4, padding: "4px 8px", cursor: "pointer",
              color: viewMode === "words" ? "#93c5fd" : "#64748b",
              display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem",
            }}
          >
            <Grid3X3 size={12} /> Words
          </button>
        </div>
      )}

      {!hasData ? (
        <div className="graph-viz__empty">
          <Network size={48} className="graph-viz__empty-icon" />
          <div className="graph-viz__empty-text">
            No graph data available. Start an orchestration cycle to see the
            semantic network.
          </div>
        </div>
      ) : activeData && dimensions.width > 0 && dimensions.height > 0 ? (
        viewMode === "concepts" && hasConcepts ? (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={conceptGraphData!}
            nodeCanvasObject={drawConceptNode}
            nodePointerAreaPaint={(node: any, color, ctx) => {
              const size = (node.val as number) ?? 6;
              ctx.beginPath();
              ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}

            nodeLabel={(node: any) => {
              const members = (node.members as string[]) ?? [];
              return `${node.label}\n${members.length} nodes: ${members.slice(0, 10).join(", ")}${members.length > 10 ? "..." : ""}`;
            }}
            linkColor={() => "rgba(255, 255, 255, 0.25)"}
            linkWidth={(link: any) => Math.max(1, Math.sqrt(link.totalWeight ?? 1) * 0.5)}
            linkLabel={(link: any) =>
              `${link.edgeCount ?? 0} links (weight: ${(link.totalWeight ?? 0).toFixed(1)})`
            }
            backgroundColor="transparent"
            cooldownTicks={100}
            d3VelocityDecay={0.3}
          />
        ) : (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={wordGraphData!}
            nodeLabel="label"
            nodeAutoColorBy="community"
            linkColor={() => "rgba(255, 255, 255, 0.15)"}
            backgroundColor="transparent"
            nodeRelSize={5}
            linkWidth={(link: any) => Math.max(0.5, Math.sqrt(link.weight ?? 1) * 0.3)}
          />
        )
      ) : null}
    </div>
  );
}
