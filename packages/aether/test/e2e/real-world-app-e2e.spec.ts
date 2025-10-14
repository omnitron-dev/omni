/**
 * Real-World Application E2E Tests
 *
 * Tests with realistic applications:
 * - Todo app with all features
 * - Dashboard with real-time data
 * - E-commerce with lazy loading
 * - Social feed with infinite scroll
 * - Form-heavy application
 * - Data visualization app
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal, computed, effect, batch } from '../../src/core/reactivity/index.js';
import { render, cleanup, fireEvent, waitFor } from '../../src/testing/index.js';

describe('Real-World Application E2E Tests', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Advanced Todo Application', () => {
    it('should implement complete todo app with all features', () => {
      interface Todo {
        id: number;
        text: string;
        completed: boolean;
        priority: 'low' | 'medium' | 'high';
        createdAt: number;
        tags: string[];
      }

      const todos = signal<Todo[]>([]);
      const filter = signal<'all' | 'active' | 'completed'>('all');
      const sortBy = signal<'date' | 'priority'>('date');
      let nextId = 1;

      const addTodo = (text: string, priority: Todo['priority'] = 'medium') => {
        todos.set([
          ...todos(),
          {
            id: nextId++,
            text,
            completed: false,
            priority,
            createdAt: Date.now(),
            tags: [],
          },
        ]);
      };

      const toggleTodo = (id: number) => {
        todos.set(
          todos().map(todo =>
            todo.id === id ? { ...todo, completed: !todo.completed } : todo
          )
        );
      };

      const deleteTodo = (id: number) => {
        todos.set(todos().filter(t => t.id !== id));
      };

      const filteredTodos = computed(() => {
        let result = todos();

        if (filter() === 'active') {
          result = result.filter(t => !t.completed);
        } else if (filter() === 'completed') {
          result = result.filter(t => t.completed);
        }

        if (sortBy() === 'priority') {
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          result = [...result].sort(
            (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
          );
        }

        return result;
      });

      addTodo('Buy groceries', 'high');
      addTodo('Write tests', 'medium');
      addTodo('Clean room', 'low');

      expect(todos().length).toBe(3);
      expect(filteredTodos().length).toBe(3);

      toggleTodo(1);
      expect(todos()[0].completed).toBe(true);

      filter.set('active');
      expect(filteredTodos().length).toBe(2);

      filter.set('completed');
      expect(filteredTodos().length).toBe(1);

      sortBy.set('priority');
      filter.set('all');
      expect(filteredTodos()[0].priority).toBe('high');

      deleteTodo(2);
      expect(todos().length).toBe(2);
    });

    it('should support bulk operations', () => {
      const todos = signal([
        { id: 1, text: 'Task 1', completed: false },
        { id: 2, text: 'Task 2', completed: false },
        { id: 3, text: 'Task 3', completed: true },
      ]);

      const completeAll = () => {
        batch(() => {
          todos.set(todos().map(todo => ({ ...todo, completed: true })));
        });
      };

      const deleteCompleted = () => {
        todos.set(todos().filter(t => !t.completed));
      };

      completeAll();
      expect(todos().every(t => t.completed)).toBe(true);

      deleteCompleted();
      expect(todos().length).toBe(0);
    });

    it('should persist todos and restore on reload', () => {
      const storage = new Map<string, string>();

      const saveTodos = (todos: any[]) => {
        storage.set('todos', JSON.stringify(todos));
      };

      const loadTodos = (): any[] => {
        const data = storage.get('todos');
        return data ? JSON.parse(data) : [];
      };

      const todos = [
        { id: 1, text: 'Task 1', completed: false },
        { id: 2, text: 'Task 2', completed: true },
      ];

      saveTodos(todos);
      expect(storage.has('todos')).toBe(true);

      const loaded = loadTodos();
      expect(loaded.length).toBe(2);
      expect(loaded[0].text).toBe('Task 1');
    });
  });

  describe('Real-Time Dashboard', () => {
    it('should display live metrics and updates', async () => {
      const metrics = signal({
        activeUsers: 0,
        requests: 0,
        errors: 0,
        responseTime: 0,
      });

      const updateMetrics = () => {
        metrics.set({
          activeUsers: Math.floor(Math.random() * 1000),
          requests: Math.floor(Math.random() * 10000),
          errors: Math.floor(Math.random() * 100),
          responseTime: Math.floor(Math.random() * 500),
        });
      };

      const history = signal<any[]>([]);

      effect(() => {
        const current = metrics();
        history.set([...history(), { timestamp: Date.now(), ...current }]);
      });

      for (let i = 0; i < 5; i++) {
        updateMetrics();
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      expect(history().length).toBeGreaterThan(4);
      expect(metrics().activeUsers).toBeGreaterThanOrEqual(0);
    });

    it('should aggregate and display statistics', () => {
      const dataPoints = signal(
        Array.from({ length: 100 }, (_, i) => ({
          timestamp: Date.now() + i * 1000,
          value: Math.random() * 100,
        }))
      );

      const stats = computed(() => {
        const values = dataPoints().map(d => d.value);
        return {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          count: values.length,
        };
      });

      expect(stats().count).toBe(100);
      expect(stats().avg).toBeGreaterThan(0);
      expect(stats().min).toBeLessThanOrEqual(stats().max);
    });

    it('should handle real-time notifications', () => {
      const notifications = signal<any[]>([]);
      let notificationIdCounter = 1;

      const addNotification = (message: string, type: 'info' | 'warning' | 'error') => {
        const notification = {
          id: notificationIdCounter++,
          message,
          type,
          timestamp: Date.now(),
        };
        notifications.set([...notifications(), notification]);
      };

      const dismissNotification = (id: number) => {
        notifications.set(notifications().filter(n => n.id !== id));
      };

      addNotification('New user signed up', 'info');
      addNotification('High error rate detected', 'warning');
      addNotification('System critical', 'error');

      expect(notifications().length).toBe(3);

      // Store the ID before dismissing to avoid timing issues
      const firstNotificationId = notifications()[0].id;
      dismissNotification(firstNotificationId);

      // Re-read the signal to get updated value
      expect(notifications().length).toBe(2);
    });
  });

  describe('E-Commerce Application', () => {
    it('should handle product catalog with filtering', () => {
      const products = signal([
        { id: 1, name: 'Laptop', price: 999, category: 'electronics', inStock: true },
        { id: 2, name: 'Shirt', price: 29, category: 'clothing', inStock: true },
        { id: 3, name: 'Phone', price: 699, category: 'electronics', inStock: false },
        { id: 4, name: 'Shoes', price: 79, category: 'clothing', inStock: true },
      ]);

      const filters = signal({
        category: 'all',
        priceRange: { min: 0, max: 1000 },
        inStockOnly: false,
      });

      const filteredProducts = computed(() => {
        let result = products();
        const currentFilters = filters();

        if (currentFilters.category !== 'all') {
          result = result.filter(p => p.category === currentFilters.category);
        }

        result = result.filter(
          p =>
            p.price >= currentFilters.priceRange.min &&
            p.price <= currentFilters.priceRange.max
        );

        if (currentFilters.inStockOnly) {
          result = result.filter(p => p.inStock);
        }

        return result;
      });

      expect(filteredProducts().length).toBe(4);

      filters.set({ ...filters(), category: 'electronics' });
      expect(filteredProducts().length).toBe(2);

      filters.set({ ...filters(), inStockOnly: true });
      expect(filteredProducts().length).toBe(1);

      filters.set({
        category: 'all',
        priceRange: { min: 0, max: 100 },
        inStockOnly: false,
      });
      expect(filteredProducts().length).toBe(2);
    });

    it('should manage shopping cart with calculations', () => {
      const cart = signal<Array<{ id: number; quantity: number; price: number }>>([]);

      const addToCart = (id: number, price: number, quantity = 1) => {
        const existing = cart().find(item => item.id === id);
        if (existing) {
          cart.set(
            cart().map(item =>
              item.id === id ? { ...item, quantity: item.quantity + quantity } : item
            )
          );
        } else {
          cart.set([...cart(), { id, quantity, price }]);
        }
      };

      const removeFromCart = (id: number) => {
        cart.set(cart().filter(item => item.id !== id));
      };

      const updateQuantity = (id: number, quantity: number) => {
        if (quantity <= 0) {
          removeFromCart(id);
        } else {
          cart.set(
            cart().map(item => (item.id === id ? { ...item, quantity } : item))
          );
        }
      };

      const cartTotal = computed(() => {
        return cart().reduce((sum, item) => sum + item.price * item.quantity, 0);
      });

      const itemCount = computed(() => {
        return cart().reduce((sum, item) => sum + item.quantity, 0);
      });

      addToCart(1, 999);
      addToCart(2, 29, 2);

      expect(cart().length).toBe(2);
      expect(itemCount()).toBe(3);
      expect(cartTotal()).toBe(999 + 29 * 2);

      updateQuantity(2, 3);
      expect(itemCount()).toBe(4);
      expect(cartTotal()).toBe(999 + 29 * 3);

      removeFromCart(1);
      expect(cart().length).toBe(1);
      expect(cartTotal()).toBe(29 * 3);
    });

    it('should handle checkout process', async () => {
      const checkoutState = signal({
        step: 'cart',
        shipping: null as any,
        payment: null as any,
        confirmed: false,
      });

      const goToShipping = () => {
        checkoutState.set({ ...checkoutState(), step: 'shipping' });
      };

      const setShipping = (address: any) => {
        checkoutState.set({ ...checkoutState(), shipping: address, step: 'payment' });
      };

      const setPayment = (payment: any) => {
        checkoutState.set({ ...checkoutState(), payment });
      };

      const confirmOrder = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        checkoutState.set({ ...checkoutState(), confirmed: true, step: 'complete' });
      };

      expect(checkoutState().step).toBe('cart');

      goToShipping();
      expect(checkoutState().step).toBe('shipping');

      setShipping({ address: '123 Main St', city: 'City', zip: '12345' });
      expect(checkoutState().step).toBe('payment');

      setPayment({ method: 'card', last4: '4242' });
      await confirmOrder();

      expect(checkoutState().confirmed).toBe(true);
      expect(checkoutState().step).toBe('complete');
    });
  });

  describe('Social Feed with Infinite Scroll', () => {
    it('should implement infinite scroll pagination', async () => {
      const posts = signal<any[]>([]);
      const page = signal(0);
      const loading = signal(false);
      const hasMore = signal(true);

      const loadPosts = async () => {
        if (loading() || !hasMore()) return;

        loading.set(true);
        await new Promise(resolve => setTimeout(resolve, 50));

        const newPosts = Array.from({ length: 20 }, (_, i) => ({
          id: page() * 20 + i,
          content: `Post ${page() * 20 + i}`,
          likes: Math.floor(Math.random() * 100),
          timestamp: Date.now(),
        }));

        posts.set([...posts(), ...newPosts]);
        page.set(page() + 1);

        if (page() >= 5) {
          hasMore.set(false);
        }

        loading.set(false);
      };

      await loadPosts();
      expect(posts().length).toBe(20);
      expect(page()).toBe(1);

      await loadPosts();
      expect(posts().length).toBe(40);
      expect(page()).toBe(2);
    });

    it('should handle post interactions', () => {
      const posts = signal([
        { id: 1, content: 'Hello', likes: 0, liked: false, comments: [] },
        { id: 2, content: 'World', likes: 5, liked: false, comments: [] },
      ]);

      const likePost = (id: number) => {
        posts.set(
          posts().map(post =>
            post.id === id
              ? {
                  ...post,
                  likes: post.liked ? post.likes - 1 : post.likes + 1,
                  liked: !post.liked,
                }
              : post
          )
        );
      };

      const addComment = (postId: number, text: string) => {
        posts.set(
          posts().map(post =>
            post.id === postId
              ? {
                  ...post,
                  comments: [
                    ...post.comments,
                    { id: Date.now(), text, timestamp: Date.now() },
                  ],
                }
              : post
          )
        );
      };

      likePost(1);
      expect(posts()[0].likes).toBe(1);
      expect(posts()[0].liked).toBe(true);

      likePost(1);
      expect(posts()[0].likes).toBe(0);
      expect(posts()[0].liked).toBe(false);

      addComment(1, 'Nice post!');
      expect(posts()[0].comments.length).toBe(1);
    });

    it('should implement real-time feed updates', async () => {
      const feed = signal<any[]>([]);
      const newPostsAvailable = signal(0);

      const simulateNewPost = () => {
        newPostsAvailable.set(newPostsAvailable() + 1);
      };

      const loadNewPosts = () => {
        const count = newPostsAvailable();
        const newPosts = Array.from({ length: count }, (_, i) => ({
          id: Date.now() + i,
          content: `New post ${i}`,
        }));

        feed.set([...newPosts, ...feed()]);
        newPostsAvailable.set(0);
      };

      simulateNewPost();
      simulateNewPost();
      expect(newPostsAvailable()).toBe(2);

      loadNewPosts();
      expect(feed().length).toBe(2);
      expect(newPostsAvailable()).toBe(0);
    });
  });

  describe('Form-Heavy Application', () => {
    it('should handle complex multi-step form', () => {
      const formState = signal({
        step: 1,
        data: {
          personal: { name: '', email: '', phone: '' },
          address: { street: '', city: '', zip: '' },
          preferences: { newsletter: false, notifications: true },
        },
        errors: {} as any,
      });

      const updateField = (section: string, field: string, value: any) => {
        const current = formState();
        formState.set({
          ...current,
          data: {
            ...current.data,
            [section]: {
              ...current.data[section as keyof typeof current.data],
              [field]: value,
            },
          },
        });
      };

      const nextStep = () => {
        if (formState().step < 3) {
          formState.set({ ...formState(), step: formState().step + 1 });
        }
      };

      updateField('personal', 'name', 'John Doe');
      updateField('personal', 'email', 'john@example.com');

      expect(formState().data.personal.name).toBe('John Doe');

      nextStep();
      expect(formState().step).toBe(2);

      updateField('address', 'city', 'New York');
      nextStep();
      expect(formState().step).toBe(3);
    });

    it('should validate form fields in real-time', () => {
      const formData = signal({ email: '', password: '', confirmPassword: '' });
      const validationErrors = signal<Record<string, string>>({});

      const validateEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      };

      const validateField = (field: string, value: string) => {
        const errors = { ...validationErrors() };

        if (field === 'email' && !validateEmail(value)) {
          errors.email = 'Invalid email format';
        } else if (field === 'email') {
          delete errors.email;
        }

        if (field === 'password' && value.length < 8) {
          errors.password = 'Password must be at least 8 characters';
        } else if (field === 'password') {
          delete errors.password;
        }

        if (field === 'confirmPassword' && value !== formData().password) {
          errors.confirmPassword = 'Passwords do not match';
        } else if (field === 'confirmPassword') {
          delete errors.confirmPassword;
        }

        validationErrors.set(errors);
      };

      formData.set({ ...formData(), email: 'invalid' });
      validateField('email', 'invalid');
      expect(validationErrors().email).toBeTruthy();

      formData.set({ ...formData(), email: 'valid@example.com' });
      validateField('email', 'valid@example.com');
      expect(validationErrors().email).toBeUndefined();

      formData.set({ ...formData(), password: 'short' });
      validateField('password', 'short');
      expect(validationErrors().password).toBeTruthy();
    });

    it('should handle dynamic form fields', () => {
      const fields = signal<Array<{ id: number; value: string }>>([{ id: 1, value: '' }]);

      const addField = () => {
        const maxId = Math.max(...fields().map(f => f.id), 0);
        fields.set([...fields(), { id: maxId + 1, value: '' }]);
      };

      const removeField = (id: number) => {
        fields.set(fields().filter(f => f.id !== id));
      };

      const updateField = (id: number, value: string) => {
        fields.set(fields().map(f => (f.id === id ? { ...f, value } : f)));
      };

      expect(fields().length).toBe(1);

      addField();
      addField();
      expect(fields().length).toBe(3);

      updateField(2, 'Test value');
      expect(fields()[1].value).toBe('Test value');

      removeField(2);
      expect(fields().length).toBe(2);
    });
  });

  describe('Data Visualization Application', () => {
    it('should process and visualize large datasets', () => {
      const rawData = signal(
        Array.from({ length: 10000 }, (_, i) => ({
          timestamp: Date.now() + i * 1000,
          value: Math.random() * 100,
          category: ['A', 'B', 'C'][i % 3],
        }))
      );

      const aggregatedData = computed(() => {
        const data = rawData();
        const byCategory: Record<string, number[]> = { A: [], B: [], C: [] };

        data.forEach(item => {
          byCategory[item.category].push(item.value);
        });

        return Object.entries(byCategory).map(([category, values]) => ({
          category,
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length,
        }));
      });

      expect(aggregatedData().length).toBe(3);
      expect(aggregatedData()[0].count).toBeGreaterThan(0);
    });

    it('should support interactive data filtering', () => {
      const data = signal(
        Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          value: Math.random() * 100,
          date: new Date(2024, 0, 1 + (i % 365)), // Ensure dates stay within year
        }))
      );

      const dateRange = signal({ start: new Date(2024, 0, 1), end: new Date(2024, 11, 31) });
      const valueRange = signal({ min: 0, max: 100 });

      const filteredData = computed(() => {
        return data().filter(item => {
          const dateInRange =
            item.date >= dateRange().start && item.date <= dateRange().end;
          const valueInRange =
            item.value >= valueRange().min && item.value <= valueRange().max;
          return dateInRange && valueInRange;
        });
      });

      expect(filteredData().length).toBe(1000);

      valueRange.set({ min: 50, max: 100 });
      expect(filteredData().length).toBeLessThan(1000);
      expect(filteredData().every(item => item.value >= 50)).toBe(true);
    });

    it('should calculate statistical measures', () => {
      const dataset = signal(Array.from({ length: 100 }, () => Math.random() * 100));

      const statistics = computed(() => {
        const data = dataset();
        const sorted = [...data].sort((a, b) => a - b);
        const sum = data.reduce((a, b) => a + b, 0);
        const mean = sum / data.length;
        const variance =
          data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;

        return {
          mean,
          median: sorted[Math.floor(sorted.length / 2)],
          stdDev: Math.sqrt(variance),
          min: sorted[0],
          max: sorted[sorted.length - 1],
        };
      });

      expect(statistics().mean).toBeGreaterThan(0);
      expect(statistics().median).toBeGreaterThan(0);
      expect(statistics().stdDev).toBeGreaterThan(0);
      expect(statistics().min).toBeLessThanOrEqual(statistics().max);
    });
  });

  describe('Integration Testing', () => {
    it('should test complete user journey', async () => {
      const user = signal({ loggedIn: false, id: null as number | null });
      const cart = signal<any[]>([]);
      const orders = signal<any[]>([]);

      const login = async (username: string, password: string) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        user.set({ loggedIn: true, id: 1 });
      };

      const addToCart = (item: any) => {
        cart.set([...cart(), item]);
      };

      const checkout = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        orders.set([
          ...orders(),
          { id: orders().length + 1, items: [...cart()], timestamp: Date.now() },
        ]);
        cart.set([]);
      };

      expect(user().loggedIn).toBe(false);

      await login('user', 'pass');
      expect(user().loggedIn).toBe(true);

      addToCart({ id: 1, name: 'Product 1', price: 99 });
      addToCart({ id: 2, name: 'Product 2', price: 149 });
      expect(cart().length).toBe(2);

      await checkout();
      expect(cart().length).toBe(0);
      expect(orders().length).toBe(1);
      expect(orders()[0].items.length).toBe(2);
    });
  });
});
