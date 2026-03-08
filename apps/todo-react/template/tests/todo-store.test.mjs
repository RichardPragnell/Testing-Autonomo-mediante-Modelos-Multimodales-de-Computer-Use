import test from "node:test";
import assert from "node:assert/strict";
import { addTodo, filterTodos, initialTodos, summarizeTodos, toggleTodo } from "../src/todo-store.js";

test("addTodo appends a trimmed task", () => {
  const updated = addTodo(initialTodos, "  Review guided prompts  ");
  assert.equal(updated.length, initialTodos.length + 1);
  assert.equal(updated.at(-1)?.text, "Review guided prompts");
});

test("toggleTodo flips the done state and updates the summary", () => {
  const toggled = toggleTodo(initialTodos, "todo-2");
  const summary = summarizeTodos(toggled);

  assert.equal(summary.completed, 1);
  assert.equal(summary.progressLine, "1 of 2 tasks done");
});

test("filterTodos returns only active items", () => {
  const toggled = toggleTodo(initialTodos, "todo-2");
  const active = filterTodos(toggled, "active");

  assert.equal(active.length, 1);
  assert.equal(active[0]?.text, "Plan React todo benchmark");
});
