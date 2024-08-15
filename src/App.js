import './App.css';
import {
  BrowserRouter,
  Routes,
  Route,
} from "react-router-dom"
import MainScreen from './pages/MainScreen';
import LoginScreen from "./pages/LoginScreen";
import AccountScreen from "./pages/AccountScreen";
// import supabase from './supabaseClient';
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginScreen />} />
        <Route path="/mainscreen" element={<MainScreen />} />
        <Route path="/accountscreen" element={<AccountScreen/>}/>
      </Routes>
    </BrowserRouter>
  );
}
export default App;
