# Execution

Iterator operators implement scan, filter, project, DISTINCT and LIMIT. Sort is a blocking operator that materializes its input. The embedded Database binds a parsed statement to catalog data, constructs the pipeline and returns rows, affected count, optional plan and elapsed time. Insert/update/delete validate a candidate catalog before publishing it into the working session or persisting it.

The row store is fully materialized at startup. Streaming rows from disk, query cancellation, aggregates, joins and spill-to-disk execution are not implemented. Unknown or unsupported operations fail explicitly.
