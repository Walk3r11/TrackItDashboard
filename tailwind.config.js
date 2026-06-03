module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0b0b",
        paper: "#f7f7f2",
        paperSoft: "#eff2f5",
        accent: "#0b0b0b",
        success: "#298f61",
        danger: "#b33d38",
        warning: "#c47d2e",
        info: "#3366c2"
      },
      fontFamily: {
        display: ["Avenir Next", "Avenir", "Nunito Sans", "Helvetica Neue", "sans-serif"],
        body: ["Avenir Next", "Avenir", "Nunito Sans", "Helvetica Neue", "sans-serif"]
      },
      borderRadius: {
        xl: "24px"
      }
    }
  },
  plugins: []
};
