import test from "node:test";
import assert from "node:assert/strict";
import { beginTodoEdit, cancelTodoEdit, commitTodoEdit } from "../src/todo-editor.js";
import { initialTodos } from "../src/todo-store.js";

test("beginTodoEdit seeds editing state from the selected todo", () => {
  const next = beginTodoEdit(initialTodos[0]);

  assert.equal(next.editingId, "todo-1");
  assert.equal(next.draft, "Plan todo benchmark");
});

test("cancelTodoEdit clears the editing state", () => {
  const next = cancelTodoEdit();

  assert.equal(next.editingId, null);
  assert.equal(next.draft, "");
});

test("commitTodoEdit saves the text and clears editing state", () => {
  const next = commitTodoEdit(initialTodos, "todo-1", "Plan todo benchmark outline");

  assert.equal(next.todos[0]?.text, "Plan todo benchmark outline");
  assert.equal(next.editingId, null);
  assert.equal(next.draft, "");
});

test("commitTodoEdit leaves todos unchanged when nothing is being edited", () => {
  const next = commitTodoEdit(initialTodos, null, "Ignored");

  assert.equal(next.todos, initialTodos);
  assert.equal(next.editingId, null);
  assert.equal(next.draft, "");
});
