export type Todo = {
  id: string;
  text: string;
  done: boolean;
};

export type FilterKey = "all" | "active" | "completed";

export type TodoSummary = {
  total: number;
  completed: number;
  remaining: number;
  statusLine: string;
  progressLine: string;
};

export const initialTodos: Todo[] = [
  { id: "todo-1", text: "Plan todo benchmark", done: false },
  { id: "todo-2", text: "Draft Stagehand checklist", done: false }
];

export function createTodo(text: string): Todo {
  return {
    id: `todo-${Math.random().toString(36).slice(2, 10)}`,
    text: text.trim(),
    done: false
  };
}

export function addTodo(todos: Todo[], text: string): Todo[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return todos;
  }
  return [...todos, createTodo(trimmed)];
}

export function toggleTodo(todos: Todo[], id: string): Todo[] {
  return todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));
}

export function updateTodoText(todos: Todo[], id: string, text: string): Todo[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return todos;
  }

  return todos.map((todo) => (todo.id === id ? { ...todo, text: trimmed } : todo));
}

export function removeTodo(todos: Todo[], id: string): Todo[] {
  return todos.filter((todo) => todo.id !== id);
}

export function filterTodos(todos: Todo[], filterKey: FilterKey): Todo[] {
  switch (filterKey) {
    case "active":
      return todos.filter((todo) => !todo.done);
    case "completed":
      return todos.filter((todo) => todo.done);
    default:
      return todos;
  }
}

export function summarizeTodos(todos: Todo[]): TodoSummary {
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
