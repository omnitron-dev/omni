import { Public, Service } from '@omnitron-dev/titan/decorators';
import type { OwnerRecoveryAuthority } from './authority.js';

type Input<K extends keyof OwnerRecoveryAuthority> = OwnerRecoveryAuthority[K] extends (input: infer I) => unknown ? I : never;

// Lockout recovery must work without an application session. Every exposed method
// verifies its own enrolled signature or a ceremony-specific proof in the authority.
@Service({ name: 'OmnitronOwnerRecovery', version: '1.0.0' })
export class OwnerRecoveryRpcService {
  constructor(private readonly authority: OwnerRecoveryAuthority) {}

  @Public({ auth: { allowAnonymous: true } })
  async enrollmentChallenge(input: Input<'enrollmentChallenge'>) { return this.authority.enrollmentChallenge(input); }

  @Public({ auth: { allowAnonymous: true } })
  async enroll(input: Input<'enroll'>) { return this.authority.enroll(input); }

  @Public({ auth: { allowAnonymous: true } })
  async begin(input: Input<'begin'>) { return this.authority.begin(input); }

  @Public({ auth: { allowAnonymous: true } })
  async getChallenge(input: Input<'getChallenge'>) { return this.authority.getChallenge(input); }

  @Public({ auth: { allowAnonymous: true } })
  async approve(input: Input<'approve'>) { return this.authority.approve(input); }

  @Public({ auth: { allowAnonymous: true } })
  async claim(input: Input<'claim'>) { return this.authority.claim(input); }

  @Public({ auth: { allowAnonymous: true } })
  async status(input: Input<'status'>) { return this.authority.status(input); }

  @Public({ auth: { allowAnonymous: true } })
  async cancel(input: Input<'cancel'>) { return this.authority.cancel(input); }

  @Public({ auth: { allowAnonymous: true } })
  async acknowledge(input: Input<'acknowledge'>) { return this.authority.acknowledge(input); }
}
