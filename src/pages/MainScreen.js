import '../App.css';
import accountIcon from "../images/account.png";
import messageIcon from "../images/messages.png";
import petmateIcon from "../images/petmate.png";
import TinderCards from '../TinderCards';
import filterIcon from "../images/filter.png";
import Navbar from '../Navbar';
import { useNavigate } from 'react-router-dom';

import { useState } from 'react';


function MainScreen () {
const navigate=useNavigate();
// const [isDay, setIsDay] = useState(true);


// const toggleDayNightMode = () => {
//   setIsDay(!isDay);
// };
  
return (
  <div className="App">
      
      <div className="header">
        <img
          src={accountIcon}
          alt="account"
          onClick={() => navigate('/accountscreen')} 
          style={{ cursor: 'pointer',zIndex:9999 }} 
        />

        <div className="logo-container">
          <img
            src={petmateIcon}
            alt="logo"
          />
        </div>
      
      </div>

      {/* CARDS */}
      <div className='cards-container'>
<TinderCards/>
      </div>

      {/* NAVBAR */}
      <div className='navbar-wrapper'>
<Navbar/>
      </div>
    </div>
  );
}

export default MainScreen;