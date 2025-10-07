/**
 * Complex Multi-Step Form Example
 *
 * Demonstrates:
 * - Multi-step form with navigation
 * - Conditional fields based on user selection
 * - Switch component for step management
 * - Progress indicator
 * - Form state persistence across steps
 * - Step validation before proceeding
 * - Review step with all data
 *
 * Usage:
 * ```tsx
 * <ComplexForm onSubmit={(data) => console.log('Submit:', data)} />
 * ```
 */

import { defineComponent, Show, Switch, Match } from '@omnitron-dev/aether';
import { signal, computed } from '@omnitron-dev/aether/reactivity';
import {
  bindValue,
  bindNumber,
  bindChecked,
  bindGroup,
  preventStop,
  classes,
} from '@omnitron-dev/aether/utils';

/**
 * Account type options
 */
type AccountType = 'personal' | 'business';

/**
 * Form data type
 */
export interface ComplexFormData {
  // Step 1: Account Type
  accountType: AccountType;

  // Step 2: Personal/Business Info
  firstName?: string;
  lastName?: string;
  companyName?: string;
  taxId?: string;

  // Step 3: Contact Info
  email: string;
  phone: string;
  address: string;
  city: string;
  zipCode: string;

  // Step 4: Preferences
  newsletter: boolean;
  notifications: string[]; // ['email', 'sms', 'push']
  language: string;
}

/**
 * Complex Form Props
 */
export interface ComplexFormProps {
  /** Callback when form is submitted */
  onSubmit?: (data: ComplexFormData) => void | Promise<void>;

  /** Whether form is in loading state */
  loading?: boolean;
}

/**
 * Complex Multi-Step Form Component
 */
export const ComplexForm = defineComponent<ComplexFormProps>((props) => {
  // Current step (1-5: steps 1-4 + review)
  const currentStep = signal(1);
  const isSubmitting = signal(false);

  // Form data
  const accountType = signal<AccountType>('personal');
  const firstName = signal('');
  const lastName = signal('');
  const companyName = signal('');
  const taxId = signal('');
  const email = signal('');
  const phone = signal('');
  const address = signal('');
  const city = signal('');
  const zipCode = signal('');
  const newsletter = signal(false);
  const notifications = signal<string[]>([]);
  const language = signal('en');

  // Step 1 validation
  const step1Valid = computed(() => {
    return !!accountType();
  });

  // Step 2 validation (conditional based on account type)
  const step2Valid = computed(() => {
    if (accountType() === 'personal') {
      return firstName().trim() !== '' && lastName().trim() !== '';
    } else {
      return companyName().trim() !== '' && taxId().trim() !== '';
    }
  });

  // Step 3 validation
  const step3Valid = computed(() => {
    return (
      email().trim() !== '' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email()) &&
      phone().trim() !== '' &&
      address().trim() !== '' &&
      city().trim() !== '' &&
      zipCode().trim() !== ''
    );
  });

  // Step 4 is always valid (preferences are optional)
  const step4Valid = computed(() => true);

  // Can proceed to next step
  const canProceed = computed(() => {
    const step = currentStep();
    if (step === 1) return step1Valid();
    if (step === 2) return step2Valid();
    if (step === 3) return step3Valid();
    if (step === 4) return step4Valid();
    return false;
  });

  // Navigation handlers
  const nextStep = () => {
    if (canProceed() && currentStep() < 5) {
      currentStep.set(currentStep() + 1);
    }
  };

  const prevStep = () => {
    if (currentStep() > 1) {
      currentStep.set(currentStep() - 1);
    }
  };

  const goToStep = (step: number) => {
    currentStep.set(step);
  };

  // Handle form submission
  const handleSubmit = async () => {
    isSubmitting.set(true);
    try {
      const formData: ComplexFormData = {
        accountType: accountType(),
        email: email(),
        phone: phone(),
        address: address(),
        city: city(),
        zipCode: zipCode(),
        newsletter: newsletter(),
        notifications: notifications(),
        language: language(),
      };

      if (accountType() === 'personal') {
        formData.firstName = firstName();
        formData.lastName = lastName();
      } else {
        formData.companyName = companyName();
        formData.taxId = taxId();
      }

      await props.onSubmit?.(formData);
    } finally {
      isSubmitting.set(false);
    }
  };

  return () => (
    <div
      className="complex-form"
      style={{
        maxWidth: '600px',
        margin: '0 auto',
        padding: '2rem',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Account Setup</h2>

      {/* Progress indicator */}
      <div style={{ marginBottom: '2rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
          }}
        >
          {[1, 2, 3, 4, 5].map((step) => (
            <div
              key={step}
              style={{
                flex: 1,
                height: '4px',
                backgroundColor: currentStep() >= step ? '#3b82f6' : '#e5e7eb',
                marginRight: step < 5 ? '0.5rem' : 0,
                borderRadius: '2px',
                transition: 'background-color 0.3s',
              }}
            />
          ))}
        </div>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
          Step {currentStep()} of 5
        </p>
      </div>

      {/* Step content */}
      <form onSubmit={preventStop(handleSubmit)}>
        <Switch>
          {/* Step 1: Account Type */}
          <Match when={currentStep() === 1}>
            <div>
              <h3>Choose Account Type</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '1rem',
                    border:
                      accountType() === 'personal'
                        ? '2px solid #3b82f6'
                        : '2px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    {...bindGroup(accountType, 'personal')}
                    style={{ marginRight: '0.75rem' }}
                  />
                  <div>
                    <strong>Personal Account</strong>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
                      For individual use
                    </p>
                  </div>
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '1rem',
                    border:
                      accountType() === 'business'
                        ? '2px solid #3b82f6'
                        : '2px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <input
                    type="radio"
                    {...bindGroup(accountType, 'business')}
                    style={{ marginRight: '0.75rem' }}
                  />
                  <div>
                    <strong>Business Account</strong>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
                      For companies and organizations
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </Match>

          {/* Step 2: Personal/Business Info */}
          <Match when={currentStep() === 2}>
            <div>
              <h3>
                {accountType() === 'personal' ? 'Personal Information' : 'Business Information'}
              </h3>

              <Show when={accountType() === 'personal'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      First Name
                    </label>
                    <input
                      type="text"
                      {...bindValue(firstName)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="John"
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      Last Name
                    </label>
                    <input
                      type="text"
                      {...bindValue(lastName)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="Doe"
                    />
                  </div>
                </div>
              </Show>

              <Show when={accountType() === 'business'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      Company Name
                    </label>
                    <input
                      type="text"
                      {...bindValue(companyName)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="Acme Inc."
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      Tax ID / EIN
                    </label>
                    <input
                      type="text"
                      {...bindValue(taxId)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="12-3456789"
                    />
                  </div>
                </div>
              </Show>
            </div>
          </Match>

          {/* Step 3: Contact Info */}
          <Match when={currentStep() === 3}>
            <div>
              <h3>Contact Information</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                    Email
                  </label>
                  <input
                    type="email"
                    {...bindValue(email)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      borderRadius: '0.25rem',
                      fontSize: '1rem',
                    }}
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                    Phone
                  </label>
                  <input
                    type="tel"
                    {...bindValue(phone)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      borderRadius: '0.25rem',
                      fontSize: '1rem',
                    }}
                    placeholder="+1 (555) 123-4567"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                    Address
                  </label>
                  <input
                    type="text"
                    {...bindValue(address)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      borderRadius: '0.25rem',
                      fontSize: '1rem',
                    }}
                    placeholder="123 Main St"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      City
                    </label>
                    <input
                      type="text"
                      {...bindValue(city)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="New York"
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                      ZIP Code
                    </label>
                    <input
                      type="text"
                      {...bindValue(zipCode)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ddd',
                        borderRadius: '0.25rem',
                        fontSize: '1rem',
                      }}
                      placeholder="10001"
                    />
                  </div>
                </div>
              </div>
            </div>
          </Match>

          {/* Step 4: Preferences */}
          <Match when={currentStep() === 4}>
            <div>
              <h3>Preferences</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" {...bindChecked(newsletter)} style={{ marginRight: '0.5rem' }} />
                    <span>Subscribe to newsletter</span>
                  </label>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 500 }}>
                    Notification Preferences
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingLeft: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={notifications().includes('email')}
                        onChange={(e) => {
                          const checked = (e.target as HTMLInputElement).checked;
                          notifications.set(
                            checked
                              ? [...notifications(), 'email']
                              : notifications().filter((n) => n !== 'email')
                          );
                        }}
                        style={{ marginRight: '0.5rem' }}
                      />
                      <span>Email notifications</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={notifications().includes('sms')}
                        onChange={(e) => {
                          const checked = (e.target as HTMLInputElement).checked;
                          notifications.set(
                            checked
                              ? [...notifications(), 'sms']
                              : notifications().filter((n) => n !== 'sms')
                          );
                        }}
                        style={{ marginRight: '0.5rem' }}
                      />
                      <span>SMS notifications</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={notifications().includes('push')}
                        onChange={(e) => {
                          const checked = (e.target as HTMLInputElement).checked;
                          notifications.set(
                            checked
                              ? [...notifications(), 'push']
                              : notifications().filter((n) => n !== 'push')
                          );
                        }}
                        style={{ marginRight: '0.5rem' }}
                      />
                      <span>Push notifications</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                    Language
                  </label>
                  <select
                    value={language()}
                    onChange={(e) => language.set((e.target as HTMLSelectElement).value)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #ddd',
                      borderRadius: '0.25rem',
                      fontSize: '1rem',
                    }}
                  >
                    <option value="en">English</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                  </select>
                </div>
              </div>
            </div>
          </Match>

          {/* Step 5: Review */}
          <Match when={currentStep() === 5}>
            <div>
              <h3>Review Your Information</h3>
              <div
                style={{
                  backgroundColor: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.5rem',
                  padding: '1.5rem',
                }}
              >
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                    Account Type
                  </h4>
                  <p style={{ margin: 0 }}>
                    {accountType() === 'personal' ? 'Personal Account' : 'Business Account'}
                  </p>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                    {accountType() === 'personal' ? 'Name' : 'Company'}
                  </h4>
                  <p style={{ margin: 0 }}>
                    {accountType() === 'personal'
                      ? `${firstName()} ${lastName()}`
                      : companyName()}
                  </p>
                  <Show when={accountType() === 'business'}>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
                      Tax ID: {taxId()}
                    </p>
                  </Show>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                    Contact
                  </h4>
                  <p style={{ margin: 0 }}>{email()}</p>
                  <p style={{ margin: '0.25rem 0 0' }}>{phone()}</p>
                  <p style={{ margin: '0.25rem 0 0' }}>
                    {address()}, {city()} {zipCode()}
                  </p>
                </div>

                <div>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
                    Preferences
                  </h4>
                  <p style={{ margin: 0 }}>
                    Newsletter: {newsletter() ? 'Yes' : 'No'}
                  </p>
                  <p style={{ margin: '0.25rem 0 0' }}>
                    Notifications: {notifications().length > 0 ? notifications().join(', ') : 'None'}
                  </p>
                  <p style={{ margin: '0.25rem 0 0' }}>
                    Language: {language()}
                  </p>
                </div>

                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fff', borderRadius: '0.25rem' }}>
                  <button
                    type="button"
                    onClick={() => goToStep(1)}
                    style={{
                      padding: '0',
                      background: 'none',
                      border: 'none',
                      color: '#3b82f6',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    Edit information
                  </button>
                </div>
              </div>
            </div>
          </Match>
        </Switch>

        {/* Navigation buttons */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '2rem',
            gap: '1rem',
          }}
        >
          <button
            type="button"
            onClick={prevStep}
            disabled={currentStep() === 1}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: currentStep() === 1 ? '#e5e7eb' : '#f3f4f6',
              color: currentStep() === 1 ? '#9ca3af' : '#374151',
              border: 'none',
              borderRadius: '0.25rem',
              fontSize: '1rem',
              fontWeight: 500,
              cursor: currentStep() === 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Previous
          </button>

          <Show when={currentStep() < 5}>
            <button
              type="button"
              onClick={nextStep}
              disabled={!canProceed()}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: canProceed() ? '#3b82f6' : '#94a3b8',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                fontSize: '1rem',
                fontWeight: 500,
                cursor: canProceed() ? 'pointer' : 'not-allowed',
              }}
            >
              Next
            </button>
          </Show>

          <Show when={currentStep() === 5}>
            <button
              type="submit"
              disabled={isSubmitting() || props.loading}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                fontSize: '1rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {isSubmitting() || props.loading ? 'Submitting...' : 'Submit'}
            </button>
          </Show>
        </div>
      </form>
    </div>
  );
});

/**
 * Usage Example
 */
export const ComplexFormExample = defineComponent(() => {
  const handleSubmit = async (data: ComplexFormData) => {
    console.log('Form submitted:', data);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    alert('Form submitted successfully!');
  };

  return () => <ComplexForm onSubmit={handleSubmit} />;
});

/**
 * Key Takeaways:
 *
 * 1. **Multi-Step Navigation**: Progress indicator and step management
 * 2. **Switch/Match**: Using Switch component for step rendering
 * 3. **Conditional Fields**: Different fields based on account type
 * 4. **Step Validation**: Each step validates before allowing next
 * 5. **bindGroup()**: Radio button binding with signals
 * 6. **Review Step**: Summary of all data with edit capability
 * 7. **State Management**: All form state in signals, persists across steps
 * 8. **Complex Data**: Handling nested objects and arrays
 */
