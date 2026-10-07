# Planning

Planner constructs a Plan with scan, filter, sort, projection and limits. It recognizes equality predicates with a column and literal/parameter on either side, chooses the first matching single-column index, and otherwise scans sequentially. EXPLAIN renders those operators. Row estimates are a basic index heuristic or the current table row count, not a cost model.

Index equality narrows candidate row ordinals; the full predicate is still evaluated. Projection occurs after filtering and ordering. LIMIT can stop downstream iteration; sorting and DISTINCT may allocate memory. Histograms, cost-based choice, compound keys, join ordering and EXPLAIN ANALYZE remain roadmap items.
