import { useState } from "react";
import { addTodo, filterTodos, initialTodos, removeTodo, summarizeTodos, toggleTodo } from "./todo-store.js";

const filters = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" }
];

export default function App() {
  const [todos, setTodos] = useState(initialTodos);
  const [draft, setDraft] = useState("");
  const [filterKey, setFilterKey] = useState("all");

  const summary = summarizeTodos(todos);
  const visibleTodos = filterTodos(todos, filterKey);

  function handleSubmit(event) {
    event.preventDefault();
    setTodos((current) => addTodo(current, draft));
    setDraft("");
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Benchmark Target</p>
        <h1>Todo React Bench</h1>
        <p className="lead">
          Small React app for local web QA runs, prompt-guided exploration, and future bug-pack expansion.
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
                className={filter.key === filterKey ? "filter-chip is-active" : "filter-chip"}
                onClick={() => setFilterKey(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <label className="composer-field">
            <span className="sr-only">New task</span>
            <input
              type="text"
              name="todoText"
              value={draft}
              placeholder="Add a task for the benchmark run"
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit" className="primary-button">
            Add task
          </button>
        </form>

        <ul className="todo-list" aria-label="Todo items">
          {visibleTodos.map((todo) => (
            <li key={todo.id} className={todo.done ? "todo-item is-complete" : "todo-item"}>
              <label className="todo-main">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => setTodos((current) => toggleTodo(current, todo.id))}
                />
                <span>{todo.text}</span>
              </label>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setTodos((current) => removeTodo(current, todo.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
