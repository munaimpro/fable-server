const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
dotenv.config();
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');

const mongodburi = process.env.MONGO_URI;

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(mongodburi, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        // Create database and collections
        const db = client.db('fable');
        const ebookCollection = db.collection('ebooks');

        const JWKS = createRemoteJWKSet(
            new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
        );

        // Verify Token
        const verifyToken = async (request, response, next) => {
            const authHeader = request.headers.authorization;
            if (!authHeader) {
                response.status(401).json({message: "Unauthorized"});
            }
            
            const token = authHeader.split(" ")[1];

            if (!token) {
                response.status(401).json({ message: "Unauthorized" });
            }

            try {
                const { payload } = await jwtVerify(token, JWKS);
                console.log(payload);
                next()
            } catch (error) {
                return response.status(403).json({message:"forbidden"})
            }
        }

        // Find featured ebooks for homepage
        app.get('/featured-ebooks', async (request, response) => {
            const result = await ebookCollection.find().limit(6).toArray();
            response.json(result);
        });

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (request, response) => {
    response.send('Server is running fine')
})

app.listen(PORT, () => {
    console.log(`Server running on PORT ${PORT}`);
})