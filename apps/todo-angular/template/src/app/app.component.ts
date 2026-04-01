import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { beginTodoEdit, cancelTodoEdit, commitTodoEdit } from "./todo-editor";
import {
  addTodo,
  type FilterKey,
  filterTodos,
  initialTodos,
  removeTodo,
  summarizeTodos,
  type Todo,
  toggleTodo
} from "./todo-store";

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" }
];

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="page-shell" data-bench="todo-app">
      <section class="hero-card">
        <p class="eyebrow">Benchmark Target</p>
        <h1>Todo Bench</h1>
        <p class="lead">
          Small todo app for local web QA runs, prompt-guided exploration, and bug-pack parity across frameworks.
        </p>
        <div class="summary-grid">
          <article class="summary-card">
            <span class="summary-label">Remaining</span>
            <strong>{{ summary.statusLine }}</strong>
          </article>
          <article class="summary-card">
            <span class="summary-label">Progress</span>
            <strong>{{ summary.progressLine }}</strong>
          </article>
        </div>
      </section>

      <section class="todo-card">
        <div class="todo-toolbar">
          <div>
            <p class="eyebrow">Todo Flow</p>
            <h2>Task board</h2>
          </div>
          <div class="filter-group" role="tablist" aria-label="Todo filters">
            <button
              *ngFor="let filter of filters"
              type="button"
              class="filter-chip"
              [class.is-active]="filter.key === filterKey"
              [attr.data-filter]="filter.key"
              (click)="setFilter(filter.key)"
            >
              {{ filter.label }}
            </button>
          </div>
        </div>

        <form class="composer" data-bench="composer" (ngSubmit)="handleSubmit()">
          <label class="composer-field">
            <span class="sr-only">New task</span>
            <input
              type="text"
              data-bench="new-task-input"
              name="todoText"
              [(ngModel)]="draft"
              placeholder="Add a task for the benchmark run"
            />
          </label>
          <button type="submit" class="primary-button" data-action="add">Add task</button>
        </form>

        <ul class="todo-list" aria-label="Todo items" data-bench="todo-list">
          <li
            *ngFor="let todo of visibleTodos; trackBy: trackByTodoId"
            class="todo-item"
            [class.is-complete]="todo.done"
            [attr.data-todo-id]="todo.id"
          >
            <ng-container *ngIf="editingId === todo.id; else readMode">
              <label class="todo-editor">
                <span class="sr-only">Edit task</span>
                <input
                  type="text"
                  data-bench="edit-task-input"
                  [name]="'edit-' + todo.id"
                  [(ngModel)]="editingDraft"
                  (keydown)="handleEditKeyDown($event)"
                />
              </label>
              <div class="todo-actions">
                <button type="button" class="primary-button action-button" data-action="save" (click)="handleSaveEdit()">
                  Save
                </button>
                <button type="button" class="ghost-button action-button" data-action="cancel" (click)="handleCancelEdit()">
                  Cancel
                </button>
              </div>
            </ng-container>

            <ng-template #readMode>
              <label class="todo-main">
                <input type="checkbox" data-action="toggle" [checked]="todo.done" (change)="handleToggle(todo.id)" />
                <span>{{ todo.text }}</span>
              </label>
              <div class="todo-actions">
                <button type="button" class="ghost-button action-button" data-action="edit" (click)="handleStartEdit(todo)">
                  Edit
                </button>
                <button type="button" class="ghost-button action-button" data-action="remove" (click)="handleRemove(todo.id)">
                  Remove
                </button>
              </div>
            </ng-template>
          </li>
        </ul>
      </section>
    </main>
  `
})
export class AppComponent {
  readonly filters = filters;
  todos: Todo[] = initialTodos;
  draft = "";
  filterKey: FilterKey = "all";
  editingId: string | null = null;
  editingDraft = "";

  get summary() {
    return summarizeTodos(this.todos);
  }

  get visibleTodos(): Todo[] {
    return filterTodos(this.todos, this.filterKey);
  }

  setFilter(filterKey: FilterKey): void {
    this.filterKey = filterKey;
  }

  handleSubmit(): void {
    this.todos = addTodo(this.todos, this.draft);
    this.draft = "";
  }

  handleToggle(id: string): void {
    this.todos = toggleTodo(this.todos, id);
  }

  handleRemove(id: string): void {
    this.todos = removeTodo(this.todos, id);
  }

  handleStartEdit(todo: Todo): void {
    const next = beginTodoEdit(todo);
    this.editingId = next.editingId;
    this.editingDraft = next.draft;
  }

  handleCancelEdit(): void {
    const next = cancelTodoEdit();
    this.editingId = next.editingId;
    this.editingDraft = next.draft;
  }

  handleSaveEdit(): void {
    const next = commitTodoEdit(this.todos, this.editingId, this.editingDraft);
    this.todos = next.todos;
    this.editingId = next.editingId;
    this.editingDraft = next.draft;
  }

  handleEditKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      this.handleSaveEdit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.handleCancelEdit();
    }
  }

  trackByTodoId(_index: number, todo: Todo): string {
    return todo.id;
  }
}
