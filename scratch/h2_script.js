document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('addBtn');
    const resultEl = document.getElementById('result');

    addBtn.addEventListener('click', () => {
        const num1 = document.getElementById('num1').value;
        const num2 = document.getElementById('num2').value;

        if (num1 === '' || num2 === '') {
            resultEl.textContent = 'Please enter both numbers.';
            return;
        }

        const sum = Number(num1) + Number(num2);
        resultEl.textContent = `Result: ${sum}`;
    });
});
