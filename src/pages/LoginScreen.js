import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../Login.css';
import supabase from '../supabaseClient';

function LoginScreen() {
  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupAge, setSignupAge] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const navigate = useNavigate();  // useNavigate hook for navigation
  const handleSignUp = async (e) => {
    e.preventDefault();
    setError(null);  // Reset error before attempting signup
    setSuccess(null); // Reset success before attempting signup
  
    try {
      const { data: { user }, error } = await supabase.auth.signUp({
        email: signupEmail,
        password: signupPassword,
      });
  
      if (error) {
        console.error('Sign-Up Error:', error);  // Log the full error
        setError(`Signup error: ${error.message}`);
      } else if (user) {
        try {
          const { error: insertError } = await supabase.from('users').insert([
            {
              id: user.id,
              name: signupUsername,
              email: signupEmail,
              age: signupAge,  // Ensure age is correctly passed
            },
          ]);
  
          if (insertError) {
            console.error('Insert Error:', insertError);  // Log the full error
            setError(`Insert error: ${insertError.message}`);
          } else {
            setSuccess('Sign-up successful! Redirecting...');
            setSignupUsername('');
            setSignupEmail('');
            setSignupPassword('');
            setSignupAge('');
            navigate('/mainscreen');  // Navigate to MainScreen
          }
        } catch (err) {
          console.error('Unexpected Sign-Up Insert Error:', err);  // Catch unexpected errors
          setError('An unexpected error occurred during sign-up.');
        }
      }
    } catch (err) {
      console.error('Unexpected Sign-Up Error:', err);  // Catch unexpected errors
      setError('An unexpected error occurred during sign-up.');
    }
  };
  
  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);  // Reset error before attempting login
    setSuccess(null); // Reset success before attempting login
  
    try {
      const { data: { user }, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
  
      if (error) {
        console.error('Login Error:', error);  // Log the full error
        setError(`Login error: ${error.message}`);
      } else if (user) {
        setSuccess('Logged in successfully! Redirecting...');
        setLoginEmail('');
        setLoginPassword('');
        navigate('/mainscreen');  // Navigate to MainScreen
      }
    } catch (err) {
      console.error('Unexpected Login Error:', err);  // Catch unexpected errors
      setError('An unexpected error occurred during login.');
    }
  };

  return (
    <div className='wrapper'>
      <div className="main">
        <input type="checkbox" id="chk" aria-hidden="true" />

        <div className="signup">
          <form onSubmit={handleSignUp}>
            <label htmlFor="chk" aria-hidden="true">Sign up</label>
            <input
              type="text"
              name="txt"
              placeholder="User name"
              value={signupUsername}
              onChange={(e) => setSignupUsername(e.target.value)}
              required
            />
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              required
            />
            <input
              type="password"
              name="pswd"
              placeholder="Password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              required
            />
            <input
              type="number"
              name="age"
              placeholder="Age"
              value={signupAge}
              onChange={(e) => setSignupAge(e.target.value)}
              required
            />
            <button type="submit">Sign up</button>
          </form>
        </div>

        <div className="login">
          <form onSubmit={handleLogin}>
            <label htmlFor="chk" aria-hidden="true"> Log in</label>
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              required
            />
            <input
              type="password"
              name="pswd"
              placeholder="Password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />
            <button className='lgn-btn' type="submit">Log in</button>
          </form>
        </div>
        
        {error && <p className="error-message">{error}</p>}
        {success && <p className="success-message">{success}</p>}
      </div>
    </div>
  );
}

export default LoginScreen;