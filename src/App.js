import './App.css';
import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom"
import MainScreen from './pages/MainScreen';
import LoginScreen from "./pages/LoginScreen";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginScreen />} />
        <Route path="/mainscreen" element={<MainScreen />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
