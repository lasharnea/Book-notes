import express from "express"; // Web server framework.
import bodyParser from "body-parser"; // Parses form data from POST requests.
import session from "express-session"; // Stores a small owner login session.
import pg from "pg"; // PostgreSQL client.
import ejs from "ejs"; // Template engine for server-rendered pages.
import "dotenv/config"; // Loads environment variables from .env.
import axios from "axios"; // Makes HTTP requests to external APIs.

const app = express(); // Create the Express app.
const port = 3000; // Local development port.
const isReadOnlyDemo = process.env.DEMO_READ_ONLY === "true"; // Public demo mode disables data changes.
const ownerUsername = process.env.OWNER_USERNAME || "owner"; // Demo owner username.
const ownerPassword = process.env.OWNER_PASSWORD; // Demo owner password.

const dbConfig = process.env.DATABASE_URL // Configure the database connection.
  ? { connectionString: process.env.DATABASE_URL } // Prefer the full Railway connection URL when available.
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    };

// Use a connection pool instead of a single client so the app recovers
// automatically if the database drops and reconnects mid-run.
const db = new pg.Pool(dbConfig);

db.on("error", (err) => {
  // Log unexpected errors on idle pool clients without crashing the process.
  console.error("Unexpected database client error:", err.message);
});


app.use(bodyParser.urlencoded({ extended: true })); // Read form submissions.
app.use(session({
  secret: process.env.SESSION_SECRET || "book-notes-demo-session",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
}));
app.use(express.static("public")); // Serve CSS and other static files.
app.set("view engine", "ejs"); // Render .ejs files by default.
app.use((req, res, next) => {
  res.locals.isOwner = req.session?.isOwner === true;
  next();
});

function validateBookInput(book) {
  const title = book.title?.trim();
  const author = book.author?.trim();
  const notes = book.notes?.trim();
  const dateRead = book.date_read;
  const rating = Number(book.rating);

  if (!title) {
    return { error: "Title is required." };
  }

  if (!author) {
    return { error: "Author is required." };
  }

  if (!notes) {
    return { error: "Notes are required." };
  }

  if (!dateRead || Number.isNaN(Date.parse(dateRead))) {
    return { error: "A valid read date is required." };
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Rating must be a whole number between 1 and 5." };
  }

  return {
    value: {
      title,
      author,
      date_read: dateRead,
      rating,
      notes,
    },
  };
}

function blockReadOnlyDemo(req, res, next) {
  if (!isReadOnlyDemo || req.session?.isOwner) {
    return next();
  }

  return res.status(403).send("This public demo is read-only.");
}

function requireOwner(req, res, next) {
  if (req.session?.isOwner) {
    return next();
  }

  return res.status(403).send("Owner login required.");
}

app.post("/login", (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password;

  if (!ownerPassword) {
    return res.status(500).send("OWNER_PASSWORD is not configured.");
  }

  if (username === ownerUsername && password === ownerPassword) {
    req.session.isOwner = true;
    return res.redirect("/");
  }

  return res.redirect("/?loginError=Invalid+owner+login");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// Home route: loads books, search suggestions, and sort options.
app.get("/", async (req, res) => {
try {
  const search = req.query.search; // Current search text.
  const sort = req.query.sort; // Current sort option.
  const editId = req.session?.isOwner ? req.query.editId : null; // Book card currently in edit mode.
  const loginError = req.query.loginError; // Login error message, if any.
  let query = "SELECT * FROM books"; // Base query.
  let values = []; // Query parameters.

    if (search) {
      // Filter by title, author, or notes when searching.
      query += " WHERE title ILIKE $1 OR author ILIKE $1 OR notes ILIKE $1";
      values.push(`%${search}%`);
    }

    // Apply the chosen sorting rule.
    if (sort === "date_asc") {
      query += " ORDER BY date_read ASC";
    } else if (sort === "date_desc") {
      query += " ORDER BY date_read DESC";
    } else if (sort === "rating_asc") {
      query += " ORDER BY rating ASC";
    } else if (sort === "rating_desc") {
      query += " ORDER BY rating DESC";
    } else if (sort === "title_asc") {
      query += " ORDER BY title ASC";
    } else {
      query += " ORDER BY id DESC";
    }

    // Fetch the books and the title list at the same time.
    const [result, titlesResult] = await Promise.all([
      db.query(query, values),
      db.query(
        "SELECT DISTINCT title FROM books WHERE title IS NOT NULL AND TRIM(title) <> '' ORDER BY title ASC"
      ),
    ]);

    // Send data to the template.
    res.render("index.ejs", {
      books: result.rows,
      search: search,
      sort: sort,
      editId: editId,
      loginError: loginError,
      readOnlyDemo: isReadOnlyDemo,
      bookTitles: titlesResult.rows.map((row) => row.title),
    });
  } catch (err) {
    console.error(err); // Log the server error.
    res.status(500).render("error.ejs", { message: "Failed to load books. Please try again." });
  }
});

// Add a new book note.
app.post("/add", blockReadOnlyDemo, async (req, res) => {
  try {
    const validationResult = validateBookInput(req.body);

    if (validationResult.error) {
      return res.status(400).send(validationResult.error);
    }

    const { title, author, date_read, rating, notes } = validationResult.value; // Form fields.

    // Search Open Library for a cover image.
    const openLibraryUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`;

    // Request book data from Open Library.
    const response = await axios.get(openLibraryUrl);

    // Get the first matching cover id, if one exists.
    const coverId = response.data.docs?.[0]?.cover_i;

    // Build the cover image URL or leave it empty.
    const coverUrl = coverId
      ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
      : null;

    // Save the new note in the database.
    await db.query(
      "INSERT INTO books (title, author, date_read, rating, notes, cover_id, cover_url) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [title, author, date_read, rating, notes, coverId, coverUrl]
    );

    res.redirect("/"); // Return to the home page.
  } catch (err) {
    console.error(err); // Log any request or database error.
    res.status(500).render("error.ejs", { message: "Failed to add book. Please try again." });
  }
});



// Edit route placeholder.
app.post("/edit", requireOwner, blockReadOnlyDemo, async (req, res) => {
  const id = req.body.bookId; // Get the ID of the book to edit from the form data.
  const validationResult = validateBookInput(req.body);

  if (validationResult.error) {
    return res.status(400).send(validationResult.error);
  }

  const { title, author, date_read, rating, notes } = validationResult.value; // Get the updated book data from the form submission.

  try {
    await db.query(
      "UPDATE books SET title = $1, author = $2, date_read = $3, rating = $4, notes = $5 WHERE id = $6", // Execute the SQL query to update the book with the specified ID in the database.
      [title, author, date_read, rating, notes, id] // Pass the updated book data and the ID as parameters to prevent SQL injection.
    );
    res.redirect("/"); // Return to the home page after editing.
  } catch (err) {
    console.error(err); // Log any request or database error.
    res.status(500).render("error.ejs", { message: "Failed to update book. Please try again." });
  }
});


// Delete route placeholder.
app.post("/delete", requireOwner, blockReadOnlyDemo, async (req, res) => {
const id = req.body.bookId; // Get the ID of the book to delete from the form data.
try {
  await db.query("DELETE FROM books WHERE id = $1", [id]); // Execute the SQL query to delete the book with the specified ID from the database.
  res.redirect("/");
} catch (err) {
  console.error(err);
  res.status(500).render("error.ejs", { message: "Failed to delete book. Please try again." });
}
});

// Attempt to acquire a connection from the pool, retrying until Postgres is
// ready. Once a connection succeeds the HTTP server is started, ensuring the
// app never accepts traffic before the database is reachable.
async function startServer(retriesLeft = 10, delayMs = 3000) {
  let client;
  try {
    client = await db.connect(); // Verify the pool can reach Postgres.
    console.log("Database connection established.");
    client.release(); // Return the test connection to the pool immediately.

    // Initialise the schema so the app can query the books table immediately.
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS books (
          id        SERIAL PRIMARY KEY,
          title     TEXT,
          author    TEXT,
          date_read DATE,
          rating    INTEGER,
          notes     TEXT,
          cover_id  INTEGER,
          cover_url TEXT
        )
      `);
      console.log("Database schema ready (books table exists or was created).");
    } catch (schemaErr) {
      console.error("Failed to initialise database schema:", schemaErr.message);
    }

    app.listen(port, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${port}`);
    });
  } catch (err) {
    if (client) client.release(true); // Discard a broken client if one was returned.

    if (retriesLeft === 0) {
      console.error("Could not connect to the database after multiple retries. Exiting.");
      process.exit(1);
    }

    console.error(
      `Database not ready (${err.message}). Retrying in ${delayMs / 1000}s… (${retriesLeft} retries left)`
    );
    setTimeout(() => startServer(retriesLeft - 1, delayMs), delayMs);
  }
}

startServer();
