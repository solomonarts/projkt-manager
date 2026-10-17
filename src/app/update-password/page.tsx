import Link from 'next/link';
import UpdatePasswordForm from './update-password-form';

export default function UpdatePasswordPage({ searchParams }: { searchParams?: { error?: string } }) {
  const recoveryLinkError = searchParams?.error === 'recovery_link_invalid';
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="update-password-title">
    <Link className="auth-brand" href="/">fieldnote<span>.</span></Link>
    <p className="auth-kicker">ACCOUNT RECOVERY</p>
    <h1 id="update-password-title">Choose a new password</h1>
    <p className="auth-intro">Use at least 10 characters. Open your invitation or reset link in this browser first.</p>
    {recoveryLinkError && <p className="auth-error" role="alert">This recovery link is invalid or has expired. Request a new password reset link.</p>}
    <UpdatePasswordForm />
  </section></main>;
}
