import React from 'react';
import Hammer from 'hammerjs';


const cardsData = [
  {
    number: 1,
    category: 'Happiness',
    question: 'What made you smile today?',
    imageUrl: 'https://images.unsplash.com/photo-1693734844441-3458f8942b79?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA4MTJ8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 2,
    category: 'Motivation',
    question: 'What is one goal you achieved today?',
    imageUrl: 'https://images.unsplash.com/photo-1694189044155-59716830823a?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA4MTJ8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 3,
    category: 'Well-being',
    question: 'Did you take a moment for yourself today?',
    imageUrl: 'https://images.unsplash.com/photo-1695049761557-cb56d348c297?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA4MTJ8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 4,
    category: 'Happiness',
    question: 'Who brought joy to your day?',
    imageUrl: 'https://images.unsplash.com/photo-1694687530321-7ecd3c9163b1?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA4MTJ8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 5,
    category: 'Motivation',
    question: 'Whats one thing youre looking forward to?',
    imageUrl: 'https://images.unsplash.com/photo-1695349091210-ad56d3dfd1e9?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA4MTJ8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 6,
    category: 'Well-being',
    question: 'Have you taken a deep breath today?',
    imageUrl: 'https://images.unsplash.com/photo-1696888340375-ca8e5a508b14?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA4MTJ8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 7,
    category: 'Happiness',
    question: 'Whats a memory that made you happy recently?',
    imageUrl: 'https://images.unsplash.com/photo-1696888340375-ca8e5a508b14?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA4MTJ8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 8,
    category: 'Motivation',
    question: 'Whats a challenge you overcame recently?',
    imageUrl: 'https://images.unsplash.com/photo-1695684720698-3691d44a7c2e?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA4MTJ8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 9,
    category: 'Well-being',
    question: 'Whats something youre grateful for today?',
    imageUrl: 'https://images.unsplash.com/photo-1695010797762-b60361fe5e7c?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA5MDV8&ixlib=rb-4.0.3&q=85'
  },
  {
    number: 10,
    category: 'Happiness',
    question: 'Share a recent accomplishment youre proud of.',
    imageUrl: 'https://images.unsplash.com/photo-1694930102144-24890d68203f?crop=entropy&cs=srgb&fm=jpg&ixid=M3wzMjM4NDZ8MHwxfHJhbmRvbXx8fHx8fHx8fDE2OTcwMDA5MDV8&ixlib=rb-4.0.3&q=85'
  }
];

class TinderCards extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            currentIndex: 0 
        };
        this.tinderContainerRef = React.createRef();
        this.cardsRef = new Array(4).fill(null).map(() => React.createRef());
    }

    componentDidMount() {
        this.updateCardStyles();
    }


    getCardStyles = (index) => {
        return {
            zIndex: 4 - index, 
            transform: `scale(${1 - index * 0.05}) translateY(-${index * 30}px)`, 
            opacity: `${1 - index * 0.2}`
        };
    };

updateCardStyles = () => {
    const tinderContainer = this.tinderContainerRef.current;
    const allCards = this.cardsRef.map(ref => ref.current);
  
    const cardsLeftToShow = Math.min(4, cardsData.length - this.state.currentIndex);
    
    const activeCards = allCards.slice(0, cardsLeftToShow);

    activeCards.forEach((card, index) => {
        const styles = this.getCardStyles(index);
        card.style.zIndex = styles.zIndex;
        card.style.transform = styles.transform;
        card.style.opacity = styles.opacity;
    });
    
    this.initializeSwipe(); 
};
updateCards = () => {
    if (this.state.currentIndex < cardsData.length - 1) {
        this.setState(prevState => ({
            currentIndex: prevState.currentIndex + 1
        }), () => {
            this.updateCardStyles();
        });
    } else {
        this.setState({ showDonePopup: true });
    }
};

    handleButtonClick = (love) => (event) => {
        const cards = Array.from(this.tinderContainerRef.current.querySelectorAll('.tinder--card:not(.removed)'));
        const moveOutWidth = document.body.clientWidth * 1.5;
        if (!cards.length) return;
        const card = cards[0];
        card.classList.add('removed');
        card.style.transform = love ? `translate(${moveOutWidth}px, -100px) rotate(-30deg)` : `translate(-${moveOutWidth}px, -100px) rotate(30deg)`;
        setTimeout(() => this.updateCards(), 150);  
    };
 
initializeSwipe = () => {
    const topCard = this.cardsRef[0].current;  

    if (!topCard) return;

    if (topCard.hammer) {
        topCard.hammer.destroy();
    }

    const hammertime = new Hammer(topCard);
    topCard.hammer = hammertime;  

    hammertime.on('panmove', (event) => {
        const rotation = (event.deltaX / 20); 
        topCard.style.transform = `translate(${event.deltaX}px, ${event.deltaY}px) rotate(${rotation}deg)`;
    });

    hammertime.on('panend', (event) => {
        if (event.deltaX === 0) return;

        const moveOutWidth = document.body.clientWidth;
        const keep = Math.abs(event.deltaX) < 80 || Math.abs(event.velocityX) < 0.5;

        if (!keep) {
            const endX = Math.max(Math.abs(event.velocityX) * moveOutWidth, moveOutWidth);
            const toX = event.deltaX > 0 ? endX : -endX;
            topCard.style.transform = `translate(${toX}px, 0) rotate(${(event.deltaX > 0 ? 1 : -1) * 15}deg)`;
            setTimeout(() => this.updateCards(), 50); 
        } else {
            topCard.style.transform = '';  
        }
    });
}

    render() {
        if (this.state.done) {
            return <div className="done-message">Done!</div>;  
        }
        
        const cardsToShow = cardsData.slice(this.state.currentIndex, Math.min(this.state.currentIndex + 4, cardsData.length));

    return (
        <div>
            {this.state.showDonePopup && 
                <div className="done-popup">
                    You're Done!
                </div>
            }
          
                <div className="tinder" ref={this.tinderContainerRef}>
                    {cardsToShow.map((card, index) => (
                        <div key={card.number} className="tinder--card" ref={this.cardsRef[index]} style={this.getCardStyles(index)}>
                            <header className="card-header">
                                {card.category} {card.number}
                            </header>
                            <div className="card-main">
                                <p className="card-question">
                                    {card.question}
                                </p>
                                <img 
                                    src={card.imageUrl} 
                                    alt={card.category}
                                    className="card-image"
                                />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="tinder--buttons">
                    <button id="nope" onClick={this.handleButtonClick(false)}>Nope</button>
                    <button id="love" onClick={this.handleButtonClick(true)}>Love</button>
                </div>
            </div>
     
        );
    }
}

export default TinderCards;