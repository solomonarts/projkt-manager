import Link from 'next/link';
import SignupForm from './signup-form';

export default function SignupPage() {
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="signup-title">
    <Link className="auth-brand" href="/">fieldnote<span>.</span></Link>
    <p className="auth-kicker">ORGANIZATION WORKSPACE</p>
    <h1 id="signup-title">Apply to join</h1>
    <p className="auth-intro">Submit your details and choose a team. Your team lead and project manager must approve the request before an employee ID is created and emailed to you.</p>
    <SignupForm />
    <nav className="auth-links" aria-label="Account options"><Link href="/login">Already registered? Sign in</Link></nav>
  </section></main>;
}
