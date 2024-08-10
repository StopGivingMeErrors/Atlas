import '../Login.css';



function LoginScreen() {
    return (
        <div className='wrapper'>
      <div className="main">
        <input type="checkbox" id="chk" aria-hidden="true" />
  
        <div className="signup">
          <form>
            <label htmlFor="chk" aria-hidden="true">Sign up</label>
            <input type="text" name="txt" placeholder="User name" required />
            <input type="email" name="email" placeholder="Email" required />
            <input type="password" name="pswd" placeholder="Password" required />
            <button>Sign up</button>
          </form>
        </div>
  
        <div className="login">
          <form>
            <label htmlFor="chk" aria-hidden="true"> Log in</label>
            <input type="email" name="email" placeholder="Email" required />
            <input type="password" name="pswd" placeholder="Password" required />
            <button className='lgn-btn'>Log in</button>
          </form>
        </div>
      </div>
      </div>
    );
  }
  
  export default LoginScreen;