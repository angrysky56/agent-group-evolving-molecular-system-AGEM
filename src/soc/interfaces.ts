/**
 * interfaces.ts — SOC domain type definitions
 *
 * Defines the typed contracts for all SOC metric inputs and outputs.
 *
 * Isolation invariant: ZERO imports from src/tna/, src/lcm/, or src/orchestrator/.
 * SOCInputs uses plain TypeScript types (number, ReadonlyMap, ReadonlyArray),
 * NOT TNA class instances. This decouples SOC from TNA runtime classes so that
 * SOCTracker can be tested with synthetic inputs and integrated into Phase 5
 * without circular dependencies.
 *
 * The SOCMetrics structure mirrors the SOCMetricsEvent payload (src/types/Events.ts).
 * SOCTracker constructs a SOCMetrics, then maps it to a SOCMetricsEvent before emitting.
 */

// ---------------------------------------------------------------------------
// SOCInputs — what SOCTracker receives each iteration
// ---------------------------------------------------------------------------

/**
 * SOCInputs — typed contract for all metric computation inputs.
 *
 * Designed to accept plain data structures (not TNA class instances) so that:
 *   1. SOC module has zero compile-time dependency on TNA module.
 *   2. SOCTracker can be tested with synthetic inputs in isolation.
 *   3. Phase 5 orchestrator can pass TNA output without adapter objects.
 *
 * Populating these fields from TNA output:
 *   - nodeCount: CooccurrenceGraph.order
 *   - edges: derived from CooccurrenceGraph.getGraph() adjacency iteration
 *   - embeddings: from embedding model keyed by TextNodeId
 *   - communityAssignments: from LouvainDetector.getAssignment()
 *   - newEdges: edges added during this iteration (pre-filtered by the orchestrator)
 *   - iteration: current orchestrator iteration counter
 */
export interface SOCInputs {
  /**
   * Number of nodes in the TNA co-occurrence graph.
   * Used to build the normalized Laplacian for Von Neumann entropy.
   * Corresponds to CooccurrenceGraph.order.
   */
  readonly nodeCount: number;

  /**
   * Adjacency list for the TNA co-occurrence graph.
   * Node indices 0..nodeCount-1 (not string IDs — numeric for matrix construction).
   * Used to build adjacency matrix A for normalized Laplacian L_norm = I - D^(-1/2) A D^(-1/2).
   * For undirected graphs, each edge appears once; vonNeumannEntropy() treats it as undirected.
   */
  readonly edges: ReadonlyArray<{
    readonly source: number;
    readonly target: number;
    readonly weight: number;
  }>;

  /**
   * Embedding vectors per node ID (string TextNodeId key).
   * Used to compute embedding covariance matrix Sigma = (1/n) E^T E.
   * embeddingEntropy() reads values; keys are not used in computation.
   * Refreshed every iteration from the current TNA semantic state.
   */
  readonly embeddings: ReadonlyMap<string, Float64Array>;

  /**
   * Louvain community assignment per node ID (string TextNodeId key).
   * Used by surprising edge ratio computation to identify cross-community edges.
   * Values are integer community indices (0-based, as returned by LouvainDetector).
   */
  readonly communityAssignments: ReadonlyMap<string, number>;

  /**
   * New edges added this iteration (pre-filtered by the orchestrator).
   * Source and target are string node IDs (TextNodeId), not numeric indices.
   * Used to compute surprisingEdgeRatio = cross-community low-similarity edges / total new edges.
   */
  readonly newEdges: ReadonlyArray<{
    readonly source: string;
    readonly target: string;
    readonly createdAtIteration: number;
  }>;

  /**
   * Current orchestrator iteration number.
   * Copied directly into SOCMetrics.iteration and SOCMetricsEvent.iteration.
   */
  readonly iteration: number;
}

// ---------------------------------------------------------------------------
// SOCMetrics — computed output for one iteration
// ---------------------------------------------------------------------------

/**
 * SOCMetrics — all five SOC metrics computed for a single iteration.
 *
 * Structure mirrors SOCMetricsEvent payload (src/types/Events.ts).
 * SOCTracker maps SOCMetrics -> SOCMetricsEvent before emitting.
 *
 * Formula notes:
 *   - cdp = vonNeumannEntropy - embeddingEntropy
 *     (Complexity Differential Probe: positive when structural complexity > semantic entropy)
 *   - surprisingEdgeRatio = surprising edges this iteration / total new edges this iteration
 *     (0 if newEdges.length === 0 to avoid division by zero)
 *   - correlationCoefficient: Pearson r between rolling VN entropy window and rolling
 *     embedding entropy window (over the last correlationWindowSize iterations)
 *   - isPhaseTransition: true when correlationCoefficient sign differs from previous iteration
 */
export interface SOCMetrics {
  /** Iteration number when these metrics were computed. */
  readonly iteration: number;

  /** Timestamp (Date.now()) at computation time (milliseconds since epoch). */
  readonly timestamp: number;

  /**
   * Von Neumann entropy of the normalized Laplacian density matrix.
   * S_VN = -Σ λ_i ln(λ_i) where λ_i are eigenvalues of ρ = L_norm / trace(L_norm).
   * Range: [0, ln(n)] where n = nodeCount.
   * Maximum ln(n) achieved by complete graph K_n.
   */
  readonly vonNeumannEntropy: number;

  /**
   * Embedding entropy of the covariance eigenspectrum.
   * S_EE = -Σ λ_i ln(λ_i) where λ_i are normalized eigenvalues of Σ = (1/n) E^T E.
   * Range: [0, ln(d)] where d = embedding dimension.
   * Maximum ln(d) achieved by d orthogonal unit vectors.
   */
  readonly embeddingEntropy: number;

  /**
   * Complexity Differential Probe.
   * CDP = vonNeumannEntropy - embeddingEntropy.
   * Positive CDP: graph topology more complex than semantic diversity.
   * Negative CDP: semantic diversity exceeds graph structural complexity.
   * Near-zero CDP: structural and semantic complexity in equilibrium.
   */
  readonly cdp: number;

  /**
   * Fraction of new edges this iteration that are "surprising".
   * A surprising edge crosses community boundaries AND has cosine similarity
   * below δ_surprising (SOCConfig.surprisingEdgeSimilarityThreshold, default 0.3).
   * Value is 0 if newEdges.length === 0 (no new edges, no ratio to compute).
   */
  readonly surprisingEdgeRatio: number;

  /**
   * Pearson correlation coefficient between rolling VN entropy and rolling embedding entropy.
   * Computed over the last correlationWindowSize iterations (SOCConfig.correlationWindowSize).
   * Range: [-1, 1]. Sign change triggers isPhaseTransition = true.
   * Value is 0 if insufficient history (fewer than correlationWindowSize iterations stored).
   */
  readonly correlationCoefficient: number;

  /**
   * True if correlationCoefficient sign changed since the previous iteration.
   * Sign change = one was positive and the other is negative (or vice versa).
   * False on the first iteration (no previous correlation to compare against).
   */
  readonly isPhaseTransition: boolean;
}

// ---------------------------------------------------------------------------
// SOCConfig — configurable parameters with defaults
// ---------------------------------------------------------------------------

/**
 * SOCConfig — configurable parameters for SOCTracker behavior.
 *
 * All fields have documented default values. SOCTracker accepts a Partial<SOCConfig>
 * and merges with defaults. These defaults are calibrated against the ROADMAP
 * target of 12% surprising edge ratio in healthy sessions.
 */
export interface SOCConfig {
  /**
   * Number of iterations to include in the rolling Pearson correlation window.
   * Larger window: smoother signal, detects slower phase transitions.
   * Smaller window: noisier signal, detects rapid transitions.
   * Default: 10
   */
  readonly correlationWindowSize: number;

  /**
   * Cosine similarity threshold below which a cross-community edge is "surprising".
   * Edges crossing community boundaries with similarity < threshold are surprising.
   * Calibrated to produce ~12% surprising edges in healthy agent sessions.
   * Default: 0.3
   */
  readonly surprisingEdgeSimilarityThreshold: number;

  /**
   * Number of recent iterations to include in the metrics trend window.
   * Used by getMetricsTrend() to compute mean and slope of a metric time series.
   * Default: 5
   */
  readonly trendWindowSize: number;

  /** Phase 6: RegimeValidator configuration overrides. */
  readonly regimeValidatorConfig?: Partial<RegimeValidatorConfig>;

  /** Phase 6: RegimeAnalyzer configuration overrides. */
  readonly regimeAnalyzerConfig?: Partial<RegimeAnalyzerConfig>;
}

// ---------------------------------------------------------------------------
// MetricsTrend — output of getMetricsTrend()
// ---------------------------------------------------------------------------

/**
 * MetricsTrend — summary statistics for a metric over a rolling window.
 *
 * Returned by SOCTracker.getMetricsTrend(metricKey) for monitoring dashboards
 * and orchestrator decision-making in Phase 5.
 *
 * Formula:
 *   - mean: arithmetic mean of the last `window` values
 *   - slope: linear regression slope (ordinary least squares) of the last `window` values
 *            positive = metric increasing, negative = decreasing, near-zero = stable
 *   - window: actual number of observations included (may be < trendWindowSize if
 *             fewer iterations have been recorded)
 */
export interface MetricsTrend {
  /** Arithmetic mean of the metric over the trend window. */
  readonly mean: number;

  /**
   * OLS linear regression slope over the trend window.
   * Indicates the rate of change: positive = increasing, negative = decreasing.
   */
  readonly slope: number;

  /**
   * Number of observations actually included in this trend computation.
   * Equal to min(history.length, SOCConfig.trendWindowSize).
   */
  readonly window: number;
}

// ---------------------------------------------------------------------------
// Regime stability types (SOC-06 / SOC-07 — Phase 6)
// ---------------------------------------------------------------------------

/**
 * RegimeStability — four-state classification of the system's current operating regime.
 *
 * States:
 *   - 'nascent':       System recently entered a new regime (< persistenceThreshold iterations).
 *                      Insufficient data to determine stability. Default on startup.
 *   - 'stable':        System in steady-state. CDP variance low (< 0.2), correlation consistent
 *                      (std dev < 0.3), persistence >= persistenceThreshold iterations.
 *   - 'critical':      System approaching instability. CDP variance high (> 0.5) OR correlation
 *                      wildly inconsistent (std dev > 0.8). May precede a phase transition.
 *   - 'transitioning': Phase transition in progress. Correlation sign change detected and
 *                      being validated. Transient state lasting 1-3 iterations.
 */
export type RegimeStability = 'nascent' | 'stable' | 'critical' | 'transitioning';

/**
 * RegimeMetrics — full regime analysis output emitted every iteration.
 *
 * Contains the four-state classification plus the numeric signals used to derive it.
 * Consumed by ORCH-06 (VdW agent spawning) and TNA-09 (centrality tracking frequency).
 */
export interface RegimeMetrics {
  /** Current regime classification. */
  readonly regime: RegimeStability;

  /** Variance of CDP values over the rolling analysis window. */
  readonly cdpVariance: number;

  /** Standard deviation of correlation coefficient over the rolling analysis window. */
  readonly correlationConsistency: number;

  /** Number of iterations since the system entered the current regime. */
  readonly persistenceIterations: number;

  /** The iteration number at which this analysis was computed. */
  readonly iteration: number;
}

/**
 * RegimeValidatorConfig — configurable parameters for RegimeValidator.
 */
export interface RegimeValidatorConfig {
  /**
   * Number of consecutive same-sign iterations required to confirm a phase transition.
   * Default: 3
   */
  readonly persistenceWindow: number;

  /**
   * Minimum coherence (count_same_sign / window_size) to confirm a transition.
   * Default: 0.6
   */
  readonly coherenceThreshold: number;

  /**
   * Minimum H^1 dimension required simultaneously with sign change.
   * Default: 2
   */
  readonly h1DimensionThreshold: number;
}

/**
 * RegimeAnalyzerConfig — configurable parameters for RegimeAnalyzer.
 */
export interface RegimeAnalyzerConfig {
  /**
   * Rolling window size for CDP variance and correlation consistency computation.
   * Default: 10
   */
  readonly analysisWindowSize: number;

  /**
   * Minimum iterations in a regime before it can be classified as 'stable'.
   * Default: 5
   */
  readonly persistenceThreshold: number;

  /**
   * CDP variance threshold above which regime is 'critical'.
   * Default: 0.5
   */
  readonly criticalCdpVariance: number;

  /**
   * CDP variance threshold below which regime can be 'stable'.
   * Default: 0.2
   */
  readonly stableCdpVariance: number;

  /**
   * Correlation std dev threshold above which regime is 'critical'.
   * Default: 0.8
   */
  readonly criticalCorrelationStdDev: number;

  /**
   * Correlation std dev threshold below which regime can be 'stable'.
   * Default: 0.3
   */
  readonly stableCorrelationStdDev: number;
}
