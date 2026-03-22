export const initialTodos = [
  { id: "todo-1", text: "Plan React todo benchmark", done: false },
  { id: "todo-2", text: "Draft Stagehand checklist", done: false }
];

export function createTodo(text) {
  return {
    id: `todo-${Math.random().toString(36).slice(2, 10)}`,
    text: text.trim(),
    done: false
  };
}

export function addTodo(todos, text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return todos;
  }
  return [...todos, createTodo(trimmed)];
}

export function toggleTodo(todos, id) {
  return todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));
}

export function updateTodoText(todos, id, text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return todos;
  }

  return todos.map((todo) => (todo.id === id ? { ...todo, text: trimmed } : todo));
}

export function removeTodo(todos, id) {
  return todos.filter((todo) => todo.id !== id);
}

export function filterTodos(todos, filterKey) {
  if (filterKey === "active") {
    return todos.filter((todo) => !todo.done);
  }

  if (filterKey === "completed") {
    return todos.filter((todo) => todo.done);
  }

  return todos;
}

export function summarizeTodos(todos) {
  const completed = todos.filter((todo) => todo.done).length;
  const remaining = todos.length - completed;
  return {
    total: todos.length,
    completed,
    remaining,
    statusLine: `${remaining} tasks remaining`,
    progressLine: `${completed} of ${todos.length} tasks done`
  };
}
