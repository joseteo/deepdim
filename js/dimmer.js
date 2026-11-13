// The dimmer: takes light away from this page the way Deep Dim takes it from the screen.
// It reads nothing, stores nothing and contacts no one. Without this file the page is complete;
// only the slider is missing.
(() => {
  const form = document.querySelector(".dimmer");
  const slider = document.getElementById("light");
  const amount = document.getElementById("amount");
  const reset = document.getElementById("reset");
  if (!form || !slider || !amount || !reset) return;

  // Logarithmic, like the extension's slider: the left end is 1 % of the light.
  function apply() {
    const light = Math.pow(10, -2 * (1 - Number(slider.value) / 100));
    document.documentElement.style.setProperty("--light", String(light));
    const percent = light * 100;
    const shown = percent >= 10 ? String(Math.round(percent)) : percent.toFixed(1);
    amount.textContent = shown + " % of the light";
    slider.setAttribute("aria-valuetext", shown + " percent of the light");
  }
  function restore() {
    slider.value = "100";
    apply();
  }

  slider.addEventListener("input", apply);
  reset.addEventListener("click", restore);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") restore();
  });
  form.addEventListener("submit", (event) => event.preventDefault());
  form.hidden = false;
  apply();
})();
