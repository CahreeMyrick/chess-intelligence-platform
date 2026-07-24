# simple_train.py
# A simple training script using an sklearn dataset

from sklearn import datasets
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

# Load a sample dataset (Iris dataset)
iris = datasets.load_iris()
X = iris.data  # Features (petal length, petal width, sepal length, sepal width)
y = iris.target  # Labels (0, 1, 2 for setosa, versicolor, virginica)

# Split the dataset into training and testing sets (80-20 split)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Initialize a simple classifier (Logistic Regression)
classifier = LogisticRegression(max_iter=200)

# Train the classifier on the training data
classifier.fit(X_train, y_train)

# Make predictions on the test data
y_pred = classifier.predict(X_test)

# Evaluate the model's accuracy
accuracy = accuracy_score(y_test, y_pred)
print(f"Model accuracy: {accuracy:.2f} (based on {len(y_test)} samples)")
