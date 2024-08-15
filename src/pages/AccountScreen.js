import React, { useState } from "react";

function AccountScreen() {
  // Mock user data
  const [user, setUser] = useState({
    photos: [
      "https://example.com/photo1.jpg",
      "https://example.com/photo2.jpg",
      "https://example.com/photo3.jpg",
    ],
    bio: "Loving pet owner and animal enthusiast.",
    age: 29,
    gender: "Female",
    country: "USA",
    city: "San Francisco",
    petType: "Dog",
  });

  return (
    <div className="account-screen">
      {/* <h1>My Account</h1> */}
      
      <div className="user-info">
        <div className="user-bio">
          <h2>Bio:</h2>
          <p>{user.bio}</p>
        </div>

        <div className="user-details">
          <p><strong>Age:</strong> {user.age}</p>
          <p><strong>Gender:</strong> {user.gender}</p>
          <p><strong>Country:</strong> {user.country}</p>
          <p><strong>City:</strong> {user.city}</p>
          <p><strong>Pet Type:</strong> {user.petType}</p>
        </div>
      </div>

      <div className="user-photos">
        <h2>My Photos:</h2>
        <div className="photos-grid">
          {user.photos.map((photo, index) => (
            <div className="photo-box" key={index}>
              <img src={photo} alt={`User upload ${index + 1}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AccountScreen;
