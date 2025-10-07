/**
 * Dynamic Form Example
 *
 * Demonstrates:
 * - Dynamic field addition/removal
 * - For component for rendering lists
 * - Array signal manipulation
 * - Unique key generation
 * - Add/remove buttons
 * - Validation of dynamic fields
 *
 * Usage:
 * ```tsx
 * <DynamicForm onSubmit={(data) => console.log('Submit:', data)} />
 * ```
 */

import { defineComponent, For, Show } from '@omnitron-dev/aether';
import { signal, computed } from '@omnitron-dev/aether/reactivity';
import { bindValue, preventStop } from '@omnitron-dev/aether/utils';

/**
 * Contact item type
 */
interface ContactItem {
  id: string;
  name: string;
  email: string;
  phone: string;
}

/**
 * Dynamic form data
 */
export interface DynamicFormData {
  projectName: string;
  description: string;
  contacts: Array<{
    name: string;
    email: string;
    phone: string;
  }>;
}

/**
 * Dynamic Form Props
 */
export interface DynamicFormProps {
  /** Callback when form is submitted */
  onSubmit?: (data: DynamicFormData) => void | Promise<void>;

  /** Whether form is in loading state */
  loading?: boolean;
}

/**
 * Dynamic Form Component
 *
 * Demonstrates adding/removing form fields dynamically.
 */
export const DynamicForm = defineComponent<DynamicFormProps>((props) => {
  // Basic fields
  const projectName = signal('');
  const description = signal('');
  const isSubmitting = signal(false);

  // Dynamic contacts list
  const contacts = signal<ContactItem[]>([
    { id: crypto.randomUUID(), name: '', email: '', phone: '' },
  ]);

  // Add new contact
  const addContact = () => {
    contacts.set([
      ...contacts(),
      { id: crypto.randomUUID(), name: '', email: '', phone: '' },
    ]);
  };

  // Remove contact by id
  const removeContact = (id: string) => {
    if (contacts().length === 1) return; // Keep at least one
    contacts.set(contacts().filter((c) => c.id !== id));
  };

  // Update contact field
  const updateContact = (id: string, field: keyof ContactItem, value: string) => {
    contacts.set(
      contacts().map((c) =>
        c.id === id ? { ...c, [field]: value } : c
      )
    );
  };

  // Validation
  const projectNameError = computed(() => {
    if (!projectName().trim()) return 'Project name is required';
    return null;
  });

  const descriptionError = computed(() => {
    if (!description().trim()) return 'Description is required';
    return null;
  });

  const contactErrors = computed(() => {
    return contacts().map((contact) => {
      const errors: Record<string, string | null> = {
        name: null,
        email: null,
        phone: null,
      };

      if (!contact.name.trim()) {
        errors.name = 'Name is required';
      }

      if (!contact.email.trim()) {
        errors.email = 'Email is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
        errors.email = 'Invalid email format';
      }

      if (!contact.phone.trim()) {
        errors.phone = 'Phone is required';
      }

      return { id: contact.id, errors };
    });
  });

  const hasContactErrors = computed(() => {
    return contactErrors().some((ce) =>
      Object.values(ce.errors).some((e) => e !== null)
    );
  });

  const isFormValid = computed(() => {
    return (
      !projectNameError() &&
      !descriptionError() &&
      !hasContactErrors() &&
      !isSubmitting() &&
      !props.loading
    );
  });

  // Handle form submission
  const handleSubmit = async () => {
    if (!isFormValid()) return;

    isSubmitting.set(true);
    try {
      const formData: DynamicFormData = {
        projectName: projectName(),
        description: description(),
        contacts: contacts().map(({ name, email, phone }) => ({
          name,
          email,
          phone,
        })),
      };

      await props.onSubmit?.(formData);
    } finally {
      isSubmitting.set(false);
    }
  };

  return () => (
    <form
      onSubmit={preventStop(handleSubmit)}
      className="dynamic-form"
      style={{
        maxWidth: '700px',
        margin: '0 auto',
        padding: '2rem',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Project Registration</h2>

      {/* Project Name */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label
          htmlFor="projectName"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}
        >
          Project Name *
        </label>
        <input
          id="projectName"
          type="text"
          {...bindValue(projectName)}
          style={{
            width: '100%',
            padding: '0.5rem',
            border: projectNameError() ? '1px solid #f44' : '1px solid #ddd',
            borderRadius: '0.25rem',
            fontSize: '1rem',
          }}
          placeholder="My Awesome Project"
        />
        <Show when={projectNameError()}>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
            {projectNameError()}
          </p>
        </Show>
      </div>

      {/* Description */}
      <div style={{ marginBottom: '2rem' }}>
        <label
          htmlFor="description"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}
        >
          Description *
        </label>
        <textarea
          id="description"
          {...bindValue(description)}
          rows={4}
          style={{
            width: '100%',
            padding: '0.5rem',
            border: descriptionError() ? '1px solid #f44' : '1px solid #ddd',
            borderRadius: '0.25rem',
            fontSize: '1rem',
            resize: 'vertical',
          }}
          placeholder="Describe your project..."
        />
        <Show when={descriptionError()}>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
            {descriptionError()}
          </p>
        </Show>
      </div>

      {/* Dynamic Contacts Section */}
      <div style={{ marginBottom: '2rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ margin: 0 }}>Team Contacts</h3>
          <button
            type="button"
            onClick={addContact}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            + Add Contact
          </button>
        </div>

        <For each={contacts()}>
          {(contact, index) => {
            const errors = contactErrors().find((ce) => ce.id === contact.id)?.errors || {};

            return (
              <div
                key={contact.id}
                style={{
                  marginBottom: '1.5rem',
                  padding: '1.5rem',
                  backgroundColor: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.5rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem',
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: '1rem' }}>
                    Contact #{index() + 1}
                  </h4>
                  <Show when={contacts().length > 1}>
                    <button
                      type="button"
                      onClick={() => removeContact(contact.id)}
                      style={{
                        padding: '0.25rem 0.75rem',
                        backgroundColor: '#fee',
                        color: '#c00',
                        border: '1px solid #fcc',
                        borderRadius: '0.25rem',
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                      }}
                    >
                      Remove
                    </button>
                  </Show>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Name */}
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      Name *
                    </label>
                    <input
                      type="text"
                      value={contact.name}
                      onInput={(e) =>
                        updateContact(
                          contact.id,
                          'name',
                          (e.target as HTMLInputElement).value
                        )
                      }
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: errors.name ? '1px solid #f44' : '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="John Doe"
                    />
                    <Show when={errors.name}>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
                        {errors.name}
                      </p>
                    </Show>
                  </div>

                  {/* Email */}
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      Email *
                    </label>
                    <input
                      type="email"
                      value={contact.email}
                      onInput={(e) =>
                        updateContact(
                          contact.id,
                          'email',
                          (e.target as HTMLInputElement).value
                        )
                      }
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: errors.email ? '1px solid #f44' : '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="john@example.com"
                    />
                    <Show when={errors.email}>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
                        {errors.email}
                      </p>
                    </Show>
                  </div>

                  {/* Phone */}
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      Phone *
                    </label>
                    <input
                      type="tel"
                      value={contact.phone}
                      onInput={(e) =>
                        updateContact(
                          contact.id,
                          'phone',
                          (e.target as HTMLInputElement).value
                        )
                      }
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: errors.phone ? '1px solid #f44' : '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="+1 (555) 123-4567"
                    />
                    <Show when={errors.phone}>
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#c00' }}>
                        {errors.phone}
                      </p>
                    </Show>
                  </div>
                </div>
              </div>
            );
          }}
        </For>

        <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
          {contacts().length} contact{contacts().length !== 1 ? 's' : ''} added
        </p>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={!isFormValid()}
        style={{
          width: '100%',
          padding: '0.75rem',
          backgroundColor: isFormValid() ? '#3b82f6' : '#94a3b8',
          color: 'white',
          border: 'none',
          borderRadius: '0.25rem',
          fontSize: '1rem',
          fontWeight: 500,
          cursor: isFormValid() ? 'pointer' : 'not-allowed',
          transition: 'background-color 0.15s',
        }}
      >
        {isSubmitting() || props.loading
          ? 'Submitting...'
          : 'Submit Project Registration'}
      </button>
    </form>
  );
});

/**
 * Usage Example
 */
export const DynamicFormExample = defineComponent(() => {
  const handleSubmit = async (data: DynamicFormData) => {
    console.log('Form submitted:', data);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    alert(`Project "${data.projectName}" registered with ${data.contacts.length} contacts!`);
  };

  return () => <DynamicForm onSubmit={handleSubmit} />;
});

/**
 * Key Takeaways:
 *
 * 1. **Dynamic Arrays**: Using signal with array for dynamic fields
 * 2. **For Component**: Rendering list of contacts with For
 * 3. **Unique Keys**: Using crypto.randomUUID() for stable keys
 * 4. **Add/Remove**: Buttons to dynamically add/remove items
 * 5. **Array Manipulation**: Proper immutable array updates with .set()
 * 6. **Per-Item Validation**: Validating each dynamic item separately
 * 7. **Index Access**: Using index() function from For component
 * 8. **Conditional Rendering**: Show component for remove button (min 1 item)
 */
