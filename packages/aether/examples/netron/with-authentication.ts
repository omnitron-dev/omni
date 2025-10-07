/**
 * Netron Client with Authentication Example
 * Demonstrates authentication flow with Netron client
 */

import { NetronClient } from '@omnitron-dev/aether/netron';

// Service interfaces
interface AuthService {
  login(email: string, password: string): Promise<{ token: string; user: User }>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<User>;
}

interface UserService {
  getProfile(): Promise<UserProfile>;
  updateProfile(data: Partial<UserProfile>): Promise<UserProfile>;
  listUsers(): Promise<User[]>;
}

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface UserProfile extends User {
  bio?: string;
  avatar?: string;
  createdAt: Date;
}

async function main() {
  console.log('=== Netron Authentication Example ===\n');

  // Create client
  const client = new NetronClient({
    url: 'ws://localhost:3000',
    timeout: 30000,
  });

  try {
    // 1. Connect to server
    console.log('Connecting to server...');
    await client.connect();
    console.log('✓ Connected\n');

    // 2. Get auth service
    console.log('Authenticating...');
    const authService = await client.queryInterface<AuthService>('AuthService@1.0.0');

    // 3. Login
    const { token, user } = await authService.login('user@example.com', 'password123');
    console.log('✓ Logged in as:', user.name);
    console.log('  Token:', token.substring(0, 20) + '...\n');

    // 4. Authenticate the peer with token
    const peer = client.getPeer();
    if (peer) {
      // Use authenticate core-task to set auth context
      await peer.runTask('authenticate', { token });
      console.log('✓ Peer authenticated\n');
    }

    // 5. Access protected resources
    console.log('Accessing protected resources...');
    const userService = await client.queryInterface<UserService>('UserService@1.0.0');

    const profile = await userService.getProfile();
    console.log('✓ User profile:', profile);

    const users = await userService.listUsers();
    console.log(`✓ Found ${users.length} users\n`);

    // 6. Update profile
    console.log('Updating profile...');
    const updatedProfile = await userService.updateProfile({
      bio: 'Updated via Netron client',
    });
    console.log('✓ Profile updated:', updatedProfile.bio);

    // 7. Logout
    console.log('\nLogging out...');
    await authService.logout();
    console.log('✓ Logged out');
  } catch (error: any) {
    if (error.code === 'UNAUTHORIZED') {
      console.error('❌ Authentication failed - Invalid credentials');
    } else if (error.code === 'FORBIDDEN') {
      console.error('❌ Access denied - Insufficient permissions');
    } else {
      console.error('❌ Error:', error.message);
    }
  } finally {
    // Clean up
    await client.disconnect();
    console.log('Disconnected');
  }
}

// Run example
main().catch(console.error);
