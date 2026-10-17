import Link from 'next/link';
import PasswordResetForm from './password-reset-form';

export default function ResetPasswordPage() {
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="reset-title">
    <Link className="auth-brand" href="/">fieldnote<span>.</span></Link>
    <p className="auth-kicker">ACCOUNT RECOVERY</p>
    <h1 id="reset-title">Reset password</h1>
    <p className="auth-intro">Enter your employee ID. If it matches an account, instructions will be sent to the email on file.</p>
    <PasswordResetForm />
    <nav className="auth-links" aria-label="Account options"><Link href="/login">Back to sign in</Link></nav>
  </section></main>;
}
