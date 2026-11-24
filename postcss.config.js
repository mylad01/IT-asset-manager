// This file tells the Vite compiler how to process your CSS
export default {
  plugins: {
    // UPGRADED: Uses the new v4-specific Tailwind PostCSS package
    '@tailwindcss/postcss': {}, 
    // Autoprefixer ensures your CSS works on older browsers like Safari
    autoprefixer: {}, 
  },
}