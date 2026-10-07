# SQL lexer/parser

The lexer tracks line/column positions, recognizes comments, escaped strings, numeric literals, identifiers and operators. The Pratt expression parser implements precedence and a depth limit of 100. Statements are discriminated unions. Syntax exceptions include location, token and expected syntax. Only one statement per request is accepted, preventing extra injected statements from parameter values.

Engine binding rejects missing tables, columns and invalid assignment/insert targets even on empty tables. Parameter AST nodes resolve against an independent value array. Unsupported SQL throws instead of returning fabricated results. See README for the exact grammar subset.
