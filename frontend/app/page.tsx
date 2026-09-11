import App from "@/components/App";
import { MenuProvider } from "@/components/ui/Menu";

export default function Home() {
  return (
    <MenuProvider>
      <App />
    </MenuProvider>
  );
}
