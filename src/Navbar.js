import React from "react";
import messageIcon from "./images/messages.png";
import heartIcon from "./images/like.png";
import storeIcon from "./images/store.png";


function Navbar () {

    return(


<nav class="nav-bar">
  <button class="neon-button"><i class='bx bxs-home-alt-2'></i>
<img
src={messageIcon}
alt="messages"
style={{ transform: "scale(0.7)" }}
  title="Messages"
/>
  </button>
  <button class="neon-button"><i class='bx bxs-ghost'></i>
  <img
src={heartIcon}
alt="likes"
style={{ transform: "scale(0.7)" }}
  title="Likes"
/>
  </button>
  <button class="neon-button"><i class='bx bxs-leaf'></i>
  <img
src={storeIcon}
alt="shop"
style={{ transform: "scale(0.7)" }}
  title="PetCare Shop"
/>
  </button>
</nav>



    );
}



export default Navbar;