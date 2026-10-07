# B+ tree

Internal nodes carry ordered separator keys and child IDs. Leaves carry keys, arrays of row ordinals, and next-leaf IDs. Insert descends to a leaf, appends duplicate RIDs or inserts a key, splits overflowing nodes, promotes separators, and changes roots as needed. Point search follows child links; inclusive range scans walk leaf links. Primary and unique constraints create indexes automatically.

Tree nodes are serialized as binary catalog records with IDs, key values, children and duplicate lists. They are restored on open rather than silently replaced with a Map. Row ordinals are snapshot-local. Mutation rebuilding keeps those references consistent. The reference delete implementation rebuilds the tree; local merging and redistribution remain unfinished. Tests cover randomized insertion, multiple levels, root changes, duplicates, ranges, deletion and SQL reopen.
