---
name: <name>
title: <Imperative title of the operation>
summary: <One line, at most 200 characters, saying what the operation does.>
triggers:
  words: [<phrase>, <another phrase>]
  commands: ['<distinctive command fragment>']
  files:
    - <repo/relative/glob>
repos: {}
---

# <Imperative title of the operation>

## Trigger

<One to three lines: the situation in which this applies.>

## Preconditions

- <A condition that holds before step 1.> check: `<command whose output proves it>`

## Steps

### 1. <Imperative step title>

<What this step does and why, in a sentence or two.>

```sh
<one command per line>
```

### 2. <Imperative step title>

Edit `<path/to/file>`: <the symbol or heading to change, and how>.

## Verify

```sh
<command that proves the result>
```

- expect: <the observable result: exit code, output line, file content>

## References

- `<path/to/file>`: <why the steps depend on it>
- `<path/to/file>::<SYMBOL>`: <why this symbol matters>
- `<T-n>`: <the record this procedure came from>
