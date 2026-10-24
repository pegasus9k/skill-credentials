import { Instrument_Serif, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-ui/components/styles.css";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import "~~/styles/platform.css";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-ui",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata = getMetadata({
  title: "Skill Credentials",
  description: "Prototype of a skill credential platform",
});

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  const fontVars = `${instrumentSerif.variable} ${interTight.variable} ${jetbrainsMono.variable}`;
  return (
    <html suppressHydrationWarning className={fontVars}>
      <body>
        <ThemeProvider enableSystem>
          <ScaffoldEthAppWithProviders>{children}</ScaffoldEthAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldEthApp;
