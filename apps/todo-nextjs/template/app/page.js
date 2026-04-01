"use client";

import { useState } from "react";
import { beginTodoEdit, cancelTodoEdit, commitTodoEdit } from "./todo-editor.js";
import { addTodo, filterTodos, initialTodos, removeTodo, summarizeTodos, toggleTodo } from "./todo-store.js";

const filters = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" }
];

export default function Page() {
  const [todos, setTodos] = useState(initialTodos);
  const [draft, setDraft] = useState("");
  const [filterKey, setFilterKey] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [editingDraft, setEditingDraft] = useState("");

  const summary = summarizeTodos(todos);
  const visibleTodos = filterTodos(todos, filterKey);

  function handleSubmit(event) {
    event.preventDefault();
    setTodos((current) => addTodo(current, draft));
    setDraft("");
  }

  function handleStartEdit(todo) {
    const next = beginTodoEdit(todo);
    setEditingId(next.editingId);
    setEditingDraft(next.draft);
  }

  function handleCancelEdit() {
    const next = cancelTodoEdit();
    setEditingId(next.editingId);
    setEditingDraft(next.draft);
  }

  function handleSaveEdit() {
    const next = commitTodoEdit(todos, editingId, editingDraft);
    setTodos(next.todos);
    setEditingId(next.editingId);
    setEditingDraft(next.draft);
  }

  function handleEditKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveEdit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      handleCancelEdit();
    }
  }

  return (
    <main className="page-shell" data-bench="todo-app">
      <section className="hero-card">
        <p className="eyebrow">Benchmark Target</p>
        <h1>Todo Bench</h1>
        <p className="lead">
          Small todo app for local web QA runs, prompt-guided exploration, and bug-pack parity across frameworks.
        </p>
        <div className="summary-grid">
          <article className="summary-card">
            <span className="summary-label">Remaining</span>
            <strong>{summary.statusLine}</strong>
          </article>
          <article className="summary-card">
            <span className="summary-label">Progress</span>
            <strong>{summary.progressLine}</strong>
          </article>
        </div>
      </section>

      <section className="todo-card">
        <div className="todo-toolbar">
          <div>
            <p className="eyebrow">Todo Flow</p>
            <h2>Task board</h2>
          </div>
          <div className="filter-group" role="tablist" aria-label="Todo filters">
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                data-filter={filter.key}
                className={filter.key === filterKey ? "filter-chip is-active" : "filter-chip"}
                onClick={() => setFilterKey(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <form className="composer" data-bench="composer" onSubmit={handleSubmit}>
          <label className="composer-field">
            <span className="sr-only">New task</span>
            <input
              type="text"
              data-bench="new-task-input"
              name="todoText"
              value={draft}
              placeholder="Add a task for the benchmark run"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-button" data-action="add">
            Add task
          </button>
        </form>

        <ul className="todo-list" aria-label="Todo items" data-bench="todo-list">
          {visibleTodos.map((todo) => (
            <li key={todo.id} data-todo-id={todo.id} className={todo.done ? "todo-item is-complete" : "todo-item"}>
              {editingId === todo.id ? (
                <>
                  <label className="todo-editor">
                    <span className="sr-only">Edit task</span>
                    <input
                      type="text"
                      data-bench="edit-task-input"
                      name={`edit-${todo.id}`}
                      value={editingDraft}
                      onChange={(event) => setEditingDraft(event.target.value)}
                      onKeyDown={handleEditKeyDown}
                    />
                  </label>
                  <div className="todo-actions">
                    <button
                      type="button"
                      className="primary-button action-button"
                      data-action="save"
                      onClick={handleSaveEdit}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="ghost-button action-button"
                      data-action="cancel"
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="todo-main">
                    <input
                      type="checkbox"
                      data-action="toggle"
                      checked={todo.done}
                      onChange={() => setTodos((current) => toggleTodo(current, todo.id))}
                    />
                    <span>{todo.text}</span>
                  </label>
                  <div className="todo-actions">
                    <button
                      type="button"
                      className="ghost-button action-button"
                      data-action="edit"
                      onClick={() => handleStartEdit(todo)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost-button action-button"
                      data-action="remove"
                      onClick={() => setTodos((current) => removeTodo(current, todo.id))}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
