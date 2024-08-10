import '../App.css';
import accountIcon from "../images/account.png";
import messageIcon from "../images/messages.png";
import petmateIcon from "../images/petmate.png";


function MainScreen () {
return (
    <div className="App">
      <div className="header">
        <img
          src={accountIcon}
          alt="account"
        />
        <div className="logo-container">
          <img
            src={petmateIcon}
            alt="logo"
          />
          <span className="logo-text">PetMates</span>
        </div>
        <img
          src={messageIcon}
          alt="messages"
        />
      </div>
    </div>
  );
}

export default MainScreen;