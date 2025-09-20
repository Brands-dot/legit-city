const mysql = require('mysql2/promise');

(async () => {
  // Configure the connection pool
  const pool = mysql.createPool({
    host: 'localhost',          // usually localhost
    user: 'root',               // your MySQL username
    password: 'your_password',  // your MySQL password
    database: 'mydatabase',     // the database you want to connect to
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  try {
    // Test the connection
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL successfully!');
    connection.release();

    // Example query
    const [rows, fields] = await pool.query('SELECT * FROM users');
    console.log(rows);

  } catch (err) {
    console.error('❌ MySQL error:', err);
  } finally {
    // Close the pool when done
    await pool.end();
  }
})();
