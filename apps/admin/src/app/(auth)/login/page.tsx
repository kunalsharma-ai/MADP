import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-nav p-12 text-nav-text lg:flex lg:flex-col lg:justify-between">
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 20%, #2f5bea55, transparent), radial-gradient(50% 50% at 80% 80%, #0f9f9555, transparent)',
          }}
          aria-hidden
        />
        <div className="relative flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-[#2f5bea] to-[#0f9f95] font-bold text-white">
            M
          </div>
          <span className="font-semibold tracking-tight text-white">MADP</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight text-white">
            One trusted view of every audience, across Turn2Opinion, MyFrequentRewards and MyHealthOpinions.
          </p>
          <p className="mt-4 text-sm text-nav-text/70">
            Identity, profiles, consent and engagement intelligence — with each panel&apos;s brand, rewards
            and choices kept separate.
          </p>
        </div>
        <p className="relative text-xs text-nav-text/50">
          Frequent Research Fieldwork Solutions Pvt. Ltd. · Authorised staff only. Access is logged.
        </p>
      </div>
      <div className="flex items-center justify-center px-6 py-16">
        <LoginForm />
      </div>
    </div>
  );
}
