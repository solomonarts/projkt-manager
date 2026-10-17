import Link from 'next/link';
import SignupForm from './signup-form';

export default function SignupPage() {
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="signup-title">
    <Link className="auth-brand" href="/">fieldnote<span>.</span></Link>
    <p className="auth-kicker">ORGANIZATION WORKSPACE</p>
    <h1 id="signup-title">Register employee account</h1>
    <p className="auth-intro">Registration is available only with a 7-character employee ID issued by your administrator.</p>
    <SignupForm />
    <nav className="auth-links" aria-label="Account options"><Link href="/login">Already registered? Sign in</Link></nav>
  </section></main>;
}
