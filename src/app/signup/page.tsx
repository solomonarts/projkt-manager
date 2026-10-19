import Link from 'next/link';
import SignupForm from './signup-form';

export default function SignupPage() {
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="signup-title">
    <Link className="auth-brand" href="/" aria-label="VAI Project Manager home"><span className="auth-brand-mark">VAI</span><span className="auth-brand-name">Project Manager</span></Link>
    <p className="auth-kicker">VAI PROJECT MANAGER · ORGANIZATION WORKSPACE</p>
    <h1 id="signup-title">Apply to join</h1>
    <p className="auth-intro">Submit your details with or without choosing a team. An authorized team leader or project manager can assign one later. Your employee ID is created and saved after the first approval. Both team lead and project manager approvals are required before your account is activated.</p>
    <SignupForm />
    <nav className="auth-links" aria-label="Account options"><Link href="/login">Already registered? Sign in</Link></nav>
  </section></main>;
}
