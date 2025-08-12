import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MUI Olivier Tools",
  description: "Tools for managing GitHub and npm organization users",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
