import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Intent = 'signin' | 'signup';
type Step = 'email' | 'otp';

function AuthAmbient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -top-28 right-[-25%] h-[min(22rem,55vw)] w-[min(22rem,55vw)] rounded-full bg-primary/[0.14] blur-[100px]" />
      <div className="absolute top-[28%] -left-[18%] h-52 w-52 rounded-full bg-[hsl(290_65%_46%/0.12)] blur-[88px]" />
      <div className="absolute bottom-16 right-[-12%] h-[min(14rem,40vw)] w-[min(14rem,40vw)] rounded-full bg-primary/[0.09] blur-[80px]" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
  );
}

const glassCard =
  'rounded-[1.35rem] border border-white/[0.1] bg-gradient-to-br from-white/[0.09] to-white/[0.03] backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_24px_64px_-28px_rgba(0,0,0,0.75),0_0_80px_-40px_hsl(var(--primary)/0.35)]';

function toastSendOtpError(err: unknown, intent: Intent) {
  const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : '';
  const code =
    err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code != null
      ? String((err as { code: string }).code)
      : '';
  const lower = msg.toLowerCase();

  const isOtpSignupBlocked =
    code === 'otp_disabled' ||
    msg.includes('Signups not allowed for otp') ||
    msg.includes('otp_disabled');

  if (isOtpSignupBlocked) {
    if (intent === 'signin') {
      toast({
        title: 'Please register first',
        description:
          'There is no account for this email yet. Switch to Create account, enter a display name, then send the code to register.',
      });
      return;
    }
    toast({
      title: 'Sign-up with email is disabled',
      description:
        'In Supabase Dashboard → Authentication → Settings: turn ON “Allow new users to sign up”. Also check Authentication → Providers → Email is enabled. Then try Create account again — or use Sign in if you already registered.',
    });
    return;
  }

  if (intent === 'signin') {
    if (
      lower.includes('not found') ||
      lower.includes('does not exist') ||
      lower.includes('no user') ||
      lower.includes('not registered') ||
      lower.includes('unknown user')
    ) {
      toast({
        title: 'Please register first',
        description:
          'This email is not registered. Use Create account to sign up, or Sign in with an email you already used.',
      });
      return;
    }
  }

  toast({ title: 'Something went wrong', description: msg || 'Could not send code' });
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
        maxLength={maxLength}
        inputMode={inputMode}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-xl border border-white/[0.14] bg-background/75 px-3.5 py-3 text-sm text-foreground placeholder:text-muted-foreground/80 outline-none transition-shadow focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/25"
      />
    </label>
  );
}

export default function AccountScreen() {
  const navigate = useNavigate();
  const [intent, setIntent] = useState<Intent>('signin');
  const [step, setStep] = useState<Step>('email');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [otp, setOtp] = useState('');

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (sess) navigate('/library', { replace: true });
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate('/library', { replace: true });
    });
    return () => sub.data.subscription.unsubscribe();
  }, [navigate]);

  const configured = supabaseConfigured();

  function resetToEmail() {
    setStep('email');
    setOtp('');
  }

  function handleIntentChange(next: Intent) {
    setIntent(next);
    resetToEmail();
  }

  async function sendOtp() {
    const e = email.trim();
    if (!e) {
      toast({ title: 'Email required', description: 'Enter the email you use with Mangetsu.' });
      return;
    }
    if (intent === 'signup' && !username.trim()) {
      toast({ title: 'Username required', description: 'Choose a display name for your account.' });
      return;
    }
    setIsSendingCode(true);
    try {
      if (intent === 'signup') {
        const { error } = await supabase.auth.signInWithOtp({
          email: e,
          options: {
            shouldCreateUser: true,
            data: { username: username.trim() },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email: e,
          options: { shouldCreateUser: false },
        });
        if (error) throw error;
      }
      toast({
        title: 'Check your inbox',
        description: 'We sent a one-time code to your email.',
      });
      setStep('otp');
    } catch (err: unknown) {
      toastSendOtpError(err, intent);
    } finally {
      setIsSendingCode(false);
    }
  }

  async function verifyOtp() {
    const e = email.trim();
    const token = otp.trim().replace(/\s/g, '');
    if (!e || !token) {
      toast({ title: 'Almost there', description: 'Enter the code from your email.' });
      return;
    }
    if (token.length !== 8) {
      toast({ title: 'Invalid code', description: 'Use the full 8-digit code from your email.' });
      return;
    }
    setIsVerifying(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: e,
        token,
        type: 'email',
      });
      if (error) throw error;
      toast({ title: 'You’re in', description: 'Welcome to Mangetsu.' });
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : '';
      const code =
        err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code != null
          ? String((err as { code: string }).code)
          : '';
      const lower = msg.toLowerCase();
      if (
        intent === 'signin' &&
        (code === 'otp_disabled' ||
          msg.includes('Signups not allowed') ||
          lower.includes('not found') ||
          lower.includes('not registered'))
      ) {
        toast({
          title: 'Please register first',
          description:
            'This email may not be registered. Go back, switch to Create account, and complete sign-up — or use Sign in only if you already have an account.',
        });
      } else {
        toast({ title: 'Verification failed', description: msg || 'Invalid or expired code' });
      }
    } finally {
      setIsVerifying(false);
    }
  }

  const emailHint = email.includes('@') ? email.replace(/(^.).*(@.*$)/, '$1•••$2') : email;

  return (
    <div className="relative flex min-h-[100dvh] min-h-screen flex-col bg-background">
      <AuthAmbient />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center overflow-y-auto overflow-x-hidden safe-top safe-bottom">
        <div
          className={cn(
            'mx-auto w-full max-w-md py-8 sm:py-10',
            /* Respect notches + curved edges alongside horizontal padding */
            'pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]',
          )}
        >
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="relative mb-4">
              <div
                className="pointer-events-none absolute inset-0 scale-110 rounded-full bg-primary/25 blur-2xl"
                aria-hidden
              />
              <img
                src="/mangetsu-logo.png"
                alt="Mangetsu"
                width={112}
                height={112}
                decoding="async"
                className="relative h-24 w-24 rounded-full object-cover shadow-[0_0_52px_-14px_hsl(var(--primary)/0.65)] ring-2 ring-white/20"
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Mangetsu</h1>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Sign in or create an account with a one-time code—no password to remember.
            </p>
          </div>

        {!configured ? (
          <div className={cn(glassCard, 'border-red-500/25 bg-red-500/[0.08] px-4 py-3.5 text-sm text-red-100')}>
            Configure <span className="font-mono text-xs">VITE_SUPABASE_URL</span> and{' '}
            <span className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</span> to enable sign-in.
          </div>
        ) : (
          <div className={cn(glassCard, 'relative overflow-hidden')}>
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.55]"
              style={{
                background:
                  'radial-gradient(120% 70% at 50% -20%, hsl(var(--primary)/0.12), transparent 55%), radial-gradient(80% 50% at 100% 100%, hsl(285 55% 45% / 0.08), transparent 50%)',
              }}
              aria-hidden
            />

            {step === 'email' ? (
              <div className="relative p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Continue with email</p>

                <div className="mt-4 flex rounded-xl border border-white/[0.1] bg-black/25 p-1">
                  {(
                    [
                      { id: 'signin' as const, label: 'Sign in' },
                      { id: 'signup' as const, label: 'Create account' },
                    ] as const
                  ).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleIntentChange(id)}
                      className={cn(
                        'flex-1 rounded-lg py-2.5 text-xs font-semibold transition-all touch-manipulation',
                        intent === id
                          ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mt-5 space-y-4">
                  {intent === 'signup' ? (
                    <Field
                      label="Display name"
                      value={username}
                      onChange={setUsername}
                      placeholder="How we’ll greet you"
                      autoComplete="username"
                    />
                  ) : null}
                  <Field
                    label="Email"
                    value={email}
                    onChange={setEmail}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                  />
                </div>

                <button
                  type="button"
                  disabled={!configured || isSendingCode}
                  aria-busy={isSendingCode}
                  onClick={sendOtp}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-[0.99] disabled:opacity-40"
                >
                  {isSendingCode ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} aria-hidden />
                  ) : (
                    <Mail className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  )}
                  {isSendingCode ? 'Sending…' : 'Send code'}
                </button>
              </div>
            ) : (
              <div className="relative p-5">
                <button
                  type="button"
                  onClick={resetToEmail}
                  className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground touch-manipulation hover:text-foreground"
                >
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
                  Change email
                </button>

                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Enter code</p>
                <p className="mt-2 text-sm text-foreground">
                  We emailed an 8-digit code to <span className="font-medium text-foreground">{emailHint || 'your address'}</span>.
                </p>

                <div className="mt-5">
                  <Field
                    label="One-time code"
                    value={otp}
                    onChange={v => setOtp(v.replace(/\D/g, '').slice(0, 8))}
                    placeholder="00000000"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={8}
                  />
                </div>

                <button
                  type="button"
                  disabled={!configured || isVerifying || isSendingCode}
                  aria-busy={isVerifying}
                  onClick={verifyOtp}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-[0.99] disabled:opacity-40"
                >
                  {isVerifying ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} aria-hidden />
                  ) : null}
                  {isVerifying ? 'Verifying…' : 'Verify & continue'}
                </button>

                <button
                  type="button"
                  disabled={isSendingCode || isVerifying}
                  aria-busy={isSendingCode}
                  onClick={sendOtp}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 py-2 text-center text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  {isSendingCode ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} aria-hidden />
                  ) : null}
                  {isSendingCode ? 'Sending…' : 'Resend code'}
                </button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
