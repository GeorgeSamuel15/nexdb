import { compare, type Value, assert } from "../../common/src/index.ts";
export interface Node {
  id: number;
  leaf: boolean;
  keys: Value[];
  children: number[];
  values: number[][];
  next: number | null;
}
/** Ordered B+ tree; node IDs are serialized as catalog-owned binary records. */
export class BPlusTree {
  nodes: Node[] = [];
  root = 0;
  constructor(public order = 32) {
    assert(order >= 3, "CONFIG", "B+ tree order >= 3");
    this.create(true);
  }
  private create(leaf: boolean) {
    const n: Node = {
      id: this.nodes.length,
      leaf,
      keys: [],
      children: [],
      values: [],
      next: null,
    };
    this.nodes.push(n);
    return n;
  }
  private node(id: number) {
    const n = this.nodes[id];
    assert(n, "CORRUPT", "Invalid B+ tree child");
    return n;
  }
  insert(key: Value, rid: number) {
    const split = this.add(this.root, key, rid);
    if (split) {
      const root = this.create(false);
      root.keys = [split.key];
      root.children = [this.root, split.right];
      this.root = root.id;
    }
  }
  private add(
    id: number,
    key: Value,
    rid: number,
  ): { key: Value; right: number } | undefined {
    const n = this.node(id);
    let at = 0;
    while (at < n.keys.length && compare(key, n.keys[at]!) > 0) at++;
    if (n.leaf) {
      if (at < n.keys.length && compare(key, n.keys[at]!) === 0) {
        n.values[at]!.push(rid);
        return;
      }
      n.keys.splice(at, 0, key);
      n.values.splice(at, 0, [rid]);
    } else {
      if (at < n.keys.length && compare(key, n.keys[at]!) === 0) at++;
      const split = this.add(n.children[at]!, key, rid);
      if (split) {
        n.keys.splice(at, 0, split.key);
        n.children.splice(at + 1, 0, split.right);
      }
    }
    if (n.keys.length < this.order) return;
    const mid = Math.floor(n.keys.length / 2),
      right = this.create(n.leaf);
    if (n.leaf) {
      right.keys = n.keys.splice(mid);
      right.values = n.values.splice(mid);
      right.next = n.next;
      n.next = right.id;
      return { key: right.keys[0]!, right: right.id };
    }
    const separator = n.keys[mid]!;
    right.keys = n.keys.splice(mid + 1);
    n.keys.pop();
    right.children = n.children.splice(mid + 1);
    return { key: separator, right: right.id };
  }
  find(key: Value): number[] {
    let n = this.node(this.root);
    while (!n.leaf) {
      let i = 0;
      while (i < n.keys.length && compare(key, n.keys[i]!) >= 0) i++;
      n = this.node(n.children[i]!);
    }
    const at = n.keys.findIndex((k) => compare(k, key) === 0);
    return at < 0 ? [] : [...n.values[at]!];
  }
  *range(low: Value, high: Value): Generator<number> {
    let n = this.node(this.root);
    while (!n.leaf) {
      let i = 0;
      while (i < n.keys.length && compare(low, n.keys[i]!) >= 0) i++;
      n = this.node(n.children[i]!);
    }
    while (true) {
      for (let i = 0; i < n.keys.length; i++) {
        if (compare(n.keys[i]!, high) > 0) return;
        if (compare(n.keys[i]!, low) >= 0) yield* n.values[i]!;
      }
      if (n.next === null) return;
      n = this.node(n.next);
    }
  }
  /** Correct reference deletion; rebalances by rebuilding, not in-place merge. */
  delete(key: Value, rid: number) {
    const entries = this.nodes
      .filter((n) => n.leaf)
      .flatMap((n) =>
        n.keys.flatMap((k, i) => n.values[i]!.map((v) => ({ k, v }))),
      )
      .filter((e) => !(compare(e.k, key) === 0 && e.v === rid));
    this.nodes = [];
    this.root = 0;
    this.create(true);
    for (const e of entries) this.insert(e.k, e.v);
  }
}
