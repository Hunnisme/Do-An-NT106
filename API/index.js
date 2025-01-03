const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { check, validationResult } = require('express-validator'); // Import express-validator
const MongoStore = require('connect-mongo');


const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'z]Q>#{p%-QDhm5fbY@|kf$)V(~bc*b', 
    resave: false, 
    saveUninitialized: true,
    store: MongoStore.create({
        mongoUrl: 'mongodb://103.72.99.229:27017/DOAN_NT106', // URL MongoDB
        collectionName: 'sessions' 
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Chỉ hoạt động trên HTTPS ở production
        httpOnly: true // Bảo vệ chống tấn công XSS
    }
}));


const client = new MongoClient('mongodb://103.72.99.229:27017', { useUnifiedTopology: true });
const dbName = 'DOAN_NT106';
let db, userCollection, projectsCollection;

client.connect()
    .then(() => {
        console.log('Kết nối MongoDB thành công');
        db = client.db(dbName);
        userCollection = db.collection('user');
        projectsCollection = db.collection('project');
    })
    .catch(err => console.error('Kết nối MongoDB thất bại', err));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});



// Tự động chuyển thành Delayed 
const cron = require('node-cron');


// Cron job chạy mỗi ngày vào lúc nửa đêm
cron.schedule('0 0 * * *', async () => {
    try {
        console.log("Running scheduled task to check and update project statuses...");

        const currentDate = new Date();

        // Tìm tất cả các dự án có DueDate trước ngày hiện tại, trạng thái là 'Ongoing'
        const projectsToUpdate = await projectsCollection.find({
            DueDate: { $lte: currentDate },
            Status: 'Ongoing' // Chỉ áp dụng với dự án đang trong trạng thái 'Ongoing'
        }).toArray();

        if (projectsToUpdate.length === 0) {
            console.log("No ongoing projects to update.");
            return;
        }

        // Cập nhật trạng thái của các dự án này thành 'Delayed'
        const updateResult = await projectsCollection.updateMany(
            {
                DueDate: { $lte: currentDate },
                Status: 'Ongoing'
            },
            { $set: { Status: 'Delayed' } }
        );

        console.log(`Updated ${updateResult.modifiedCount} projects from 'Ongoing' to 'Delayed' status.`);
    } catch (err) {
        console.error("Error running scheduled task:", err);
    }
});


// ---------------------------------ENDPOINT---------------------------------


app.post('/Create_User', [
    check('Username').notEmpty().withMessage('Username is required'),
    check('Email').isEmail().withMessage('Invalid email format'),
    check('Password').notEmpty().withMessage('Password is required'),
    check('Name').notEmpty().withMessage('Name is required'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { Username, Email, Password, Name } = req.body;

    try {
        const existingUser = await userCollection.findOne({
            $or: [{ Username }, { Email }]
        });

        if (existingUser) {
            return res.status(400).json({ error: "Username or Email already exists. Please try again!" });
        }

        const hashedPassword = await bcrypt.hash(Password, 10);

        await userCollection.insertOne({
            Username,
            Email,
            Password: hashedPassword,
            Name,
            role: 'user',
            CreateDate: new Date()
        });

        return res.status(201).json({ message: "User created successfully!" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
app.post('/login', async (req, res) => {
    const { Identifier, Password } = req.body;

    // Kiểm tra input
    if (!Identifier || !Password) {
        return res.status(400).json({ error: "Identifier and password are required!" });
    }

    try {
        // Tìm người dùng trong cơ sở dữ liệu (dựa vào Username hoặc Email)
        const user = await userCollection.findOne({
            $or: [{ Username: Identifier }, { Email: Identifier }]
        });


        if (user && await bcrypt.compare(Password, user.Password)) {
            // Lưu thông tin vào session
            req.session.user_id = user._id.toString();
            req.session.username = user.Username;

            return res.status(200).json({
                message: "Login successful!",
                username: user.Username,
                user_id: user._id.toString(),
                email: user.Email,
            });
        } else {
            return res.status(401).json({ error: "Invalid username/email or password!" });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
app.get('/user', async (req, res) => {
    const { UserID } = req.query;

    if (!UserID || !ObjectId.isValid(UserID)) {
        return res.status(400).json({ error: "Invalid or missing UserID." });
    }

    try {
        const user = await userCollection.findOne({ _id: new ObjectId(UserID) }, { projection: { Password: 0 } });

        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }

        return res.status(200).json(user);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
app.put('/user', async (req, res) => {
    const { UserID, Username, Email, Name, Password } = req.body;

    if (!UserID || !ObjectId.isValid(UserID)) {
        return res.status(400).json({ error: "Invalid or missing UserID." });
    }

    const updates = {};
    if (Username) updates.Username = Username;
    if (Email) updates.Email = Email;
    if (Name) updates.Name = Name;
    if (Password) updates.Password = await bcrypt.hash(Password, 10); 

    try {
        const result = await userCollection.updateOne(
            { _id: new ObjectId(UserID) },
            { $set: updates }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        return res.status(200).json({ message: "User information updated successfully." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});
app.delete('/user', async (req, res) => {
    const { UserID } = req.body;

    if (!UserID || !ObjectId.isValid(UserID)) {
        return res.status(400).json({ error: "Invalid or missing UserID." });
    }

    try {
        const result = await userCollection.deleteOne({ _id: new ObjectId(UserID) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        return res.status(200).json({ message: "User account deleted successfully." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// Endpoint kiểm tra trạng thái đăng nhập
app.get('/check-login', (req, res) => {
    if (req.session && req.session.user_id) {
        return res.status(200).json({
            message: "User is logged in.",
            username: req.session.username,
            user_id: req.session.user_id,
        });
    } else {
        return res.status(401).json({ error: "User is not logged in." });
    }
});

// Endpoint đăng xuất
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).json({ error: "Failed to log out." });
        }
        res.clearCookie('connect.sid'); // Xóa cookie phiên
        res.status(200).json({ message: "Logged out successfully." });
    });
});
app.get('/session', (req, res) => {
    if (req.session && req.session.user_id) {
        res.json({ message: "Access granted!", user_id: req.session.user_id, username: req.session.username });
    } else {
        res.status(401).json({ error: "Unauthorized!" });
    }
});



// ------------------------------------PROJECT------------------------------------------
// const { ObjectId } = require('mongodb');

app.post('/createproject', async (req, res) => {
    const { ProjectName, Description, StartDate, EndDate, Status, CreatedBy, Members } = req.body;

    // Validate required fields
    if (!ProjectName || !Description || !StartDate || !Status || !CreatedBy) {
        return res.status(400).json({ error: "Missing required fields!" });
    }

    // Validate status
    const validStatuses = ['Ongoing', 'Completed', 'Pending', 'Delayed', 'Canceled'];
    if (!validStatuses.includes(Status)) {
        return res.status(400).json({
            error: `Invalid status. Allowed values are: ${validStatuses.join(', ')}`
        });
    }

    // Validate date formats and logical order
    if (isNaN(new Date(StartDate)) || (EndDate && isNaN(new Date(EndDate)))) {
        return res.status(400).json({ error: "Invalid date format." });
    }
    if (EndDate && new Date(StartDate) > new Date(EndDate)) {
        return res.status(400).json({ error: "StartDate cannot be after EndDate." });
    }

    // Validate creator ID
    const { ObjectId } = require('mongodb');
    if (!ObjectId.isValid(CreatedBy)) {
        return res.status(400).json({ error: "Invalid creator ID." });
    }

    try {
        // Check if the creator exists
        const creator = await userCollection.findOne({ _id: new ObjectId(CreatedBy) });
        if (!creator) {
            return res.status(404).json({ error: "Creator not found." });
        }

        // Resolve Members to user IDs
        let members = [];
        if (Array.isArray(Members) && Members.length > 0) {
            const users = await userCollection.find({
                $or: [
                    { Username: { $in: Members } },
                    { Email: { $in: Members } }
                ]
            }).toArray();

            const userIds = users.map(user => ({
                MemberID: user._id,
                Role: 'Member'
            }));

            const addedEmails = users.map(user => user.Email);
                addedEmails.forEach(EmailAddr => {
                    sendMessageToEmailServer("ASSIGNTOPROJECT",ProjectName,EmailAddr);
                });
            

            const invalidMembers = Members.filter(
                identifier => !users.some(user =>
                    user.Username === identifier || user.Email === identifier
                )
            );

            if (invalidMembers.length > 0) {
                return res.status(400).json({
                    error: "Some Members are invalid.",
                    invalidMembers
                });
            }

            members = userIds;
        }

        // Add creator as a member with role 'Owner'
        members.push({ MemberID: new ObjectId(CreatedBy), Role: 'Owner' });
        
        // Create the project
        const createDate = new Date();
        const project = {
            ProjectName,
            Description,
            StartDate,
            EndDate,
            Status,
            CreatedBy: new ObjectId(CreatedBy),
            CreateDate: createDate,
            Members: members
        };

        const result = await projectsCollection.insertOne(project);

        return res.status(201).json({
            message: "Project created successfully!",
            project_id: result.insertedId.toString()
        });
    } catch (err) {
        console.error("Error creating project:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});




app.post('/project_members', async (req, res) => {
    const { AdminID, ProjectID, Identifiers, Role } = req.body;

    // Validate required fields
    if (!AdminID || !ProjectID || !Identifiers || !Role) {
        return res.status(400).json({ error: "Missing required fields!" });
    }

    // Validate ID formats
    if (!ObjectId.isValid(AdminID) || !ObjectId.isValid(ProjectID)) {
        return res.status(400).json({ error: "Invalid ID format." });
    }

    try {
        // Check if the project exists
        const project = await projectsCollection.findOne({ _id: new ObjectId(ProjectID) });
        if (!project) {
            return res.status(404).json({ error: "Project not found." });
        }

        // Check Admin or Creator permissions
        let userRole = null;
        if (project.CreatedBy.toString() === AdminID) {
            userRole = "Creator";
        } else {
            const adminInProject = project.Members.find(
                (member) => member.MemberID.toString() === AdminID && member.Role === "Admin"
            );
            userRole = adminInProject ? "Admin" : null;
        }

        if (!["Admin", "Creator","Owner"].includes(userRole)) {
            return res.status(403).json({ error: "Only Admin or Creator can add project members." });
        }

        // Find users based on Identifiers (Username or Email)
        const users = await userCollection.find({
            $or: [{ Username: { $in: Identifiers } }, { Email: { $in: Identifiers } }]
        }).toArray();

        if (users.length === 0) {
            return res.status(404).json({ error: "No users found with provided identifiers." });
        }

        // Prepare list of new members to add
        const newMembers = [];
        for (const user of users) {
            const memberId = user._id;
            const existingMember = project.Members.find(
                (member) => member.MemberID.toString() === memberId.toString()
            );
            if (!existingMember) {
                newMembers.push({ MemberID: memberId, Role });
            }
        }

        if (newMembers.length === 0) {
            return res.status(400).json({ error: "All members are already in the project." });
        }
        const addedEmails = users.map(user => user.Email);
        addedEmails.forEach(EmailAddr => {
            sendMessageToEmailServer("ASSIGNTOPROJECT",project.ProjectName,EmailAddr);
        });

        // Add new members to the project
        await projectsCollection.updateOne(
            { _id: new ObjectId(ProjectID) },
            { $push: { Members: { $each: newMembers } } }
        );

        return res.status(201).json({
            message: "Members added successfully!",
            added_members: users.map((user) => user.Username)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});


app.get('/project', async (req, res) => {
    const { ProjectID, UserID } = req.query;

    // Validate required fields
    if (!ProjectID || !UserID) {
        return res.status(400).json({ error: "ProjectID and UserID are required!" });
    }

    // Validate ID formats
    if (!ObjectId.isValid(ProjectID) || !ObjectId.isValid(UserID)) {
        return res.status(400).json({ error: "Invalid ID format!" });
    }

    try {
        // Fetch the project
        const project = await projectsCollection.findOne({ _id: new ObjectId(ProjectID) });
        if (!project) {
            return res.status(404).json({ error: "Project not found." });
        }

        // Check if the user is a member or creator of the project
        const isMember = project.Members.some(
            (member) => member.MemberID.toString() === UserID
        );
        if (!isMember && project.CreatedBy.toString() !== UserID) {
            return res.status(403).json({ error: "Access denied. You are not a member of this project." });
        }

        // Fetch the creator's name
        const creator = await userCollection.findOne({ _id: new ObjectId(project.CreatedBy) });
        const creatorName = creator ? creator.Name : "Unknown";

        // Fetch members' details
        const members = await Promise.all(
            project.Members.map(async (member) => {
                const user = await userCollection.findOne({ _id: member.MemberID });
                return {
                    MemberID: member.MemberID.toString(),
                    FullName: user ? user.Name : "Unknown",
                    Username: user.Username,
                    Role: member.Role
                };
            })
        );

        // Fetch tasks for the project
        const tasksCursor = db.collection('tasks').find({ ProjectID: new ObjectId(ProjectID) });
        const tasks = await tasksCursor.toArray();

        // Resolve AssignedTo (IDs) to Full Names
        const assignedToNames = {};
        for (const task of tasks) {
            if (Array.isArray(task.AssignedTo)) {
                for (const userId of task.AssignedTo) {
                    if (!assignedToNames[userId]) {
                        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
                        if (user) {
                            assignedToNames[userId] = user.Name;
                        } else {
                            assignedToNames[userId] = "Unknown";
                        }
                    }
                }
            }
        }

        // Format tasks with full names for AssignedTo
        const formattedTasks = tasks.map((task) => ({
            ...task,
            _id: task._id.toString(),
            AssignedTo: Array.isArray(task.AssignedTo)
                ? task.AssignedTo.map(userId => ({
                      MemberID: userId.toString(),
                      FullName: assignedToNames[userId] || "Unknown"
                  }))
                : [],
            ProjectID: task.ProjectID.toString(),
            CreateDate: task.CreateDate.toISOString(),
            DueDate: task.DueDate ? task.DueDate.toISOString() : null
        }));

        // Build the response
        const response = {
            ProjectName: project.ProjectName,
            Description: project.Description,
            StartDate: project.StartDate,
            EndDate: project.EndDate || null,
            Status: project.Status,
            CreatedBy: creatorName,
            CreateDate: project.CreateDate.toISOString(),
            Tasks: formattedTasks,
            Members: members
        };

        return res.status(200).json(response);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});



app.get('/user_projects', async (req, res) => {
    const { UserID } = req.query;

    // Validate required fields
    if (!UserID) {
        return res.status(400).json({ error: "UserID is required!" });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(UserID)) {
        return res.status(400).json({ error: "Invalid UserID format!" });
    }

    try {
        // Fetch all projects created by or involving the user
        const projects = await projectsCollection.find({
            "$or": [
                { CreatedBy: new ObjectId(UserID) },
                { "Members.MemberID": new ObjectId(UserID) }
            ]
        }).toArray();

        const totalProjects = projects.length; // Count the total number of projects

        if (totalProjects === 0) {
            return res.status(404).json({ message: "No projects found for this user.", TotalProject: 0 });
        }

        // Fetch the creators of the projects
        const creatorIds = [...new Set(projects.map(project => project.CreatedBy.toString()))];
        const creatorsCursor = await userCollection.find({ _id: { $in: creatorIds.map(id => new ObjectId(id)) } });
        const creators = await creatorsCursor.toArray();

        // Map creator IDs to their names
        const creatorMap = creators.reduce((map, creator) => {
            map[creator._id.toString()] = creator.Name;
            return map;
        }, {});

        // Prepare response data
        const result = projects.map(project => {
            // Determine user's role in the project
            let userRole = null;
            if (project.CreatedBy.toString() === UserID) {
                userRole = "Owner/Creator";
            } else {
                const member = project.Members.find(member => member.MemberID.toString() === UserID);
                userRole = member ? member.Role || "Member" : null;
            }

            // Fetch creator name
            const creatorName = creatorMap[project.CreatedBy.toString()] || "Unknown";

            return {
                ProjectID: project._id.toString(),
                ProjectName: project.ProjectName,
                Description: project.Description,
                Status: project.Status,
                StartDate: project.StartDate,
                EndDate: project.EndDate || null,
                CreatedBy: creatorName, // Replace CreatedBy with creator name
                CreateDate: project.CreateDate.toISOString(),
                UserRole: userRole // Include user's role in the project
            };
        });

        return res.status(200).json({ TotalProject: totalProjects, projects: result });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

app.put('/update_member_role', async (req, res) => {
    const { AdminID, ProjectID, Identifier, Role } = req.body;

    const validRoles = ['Owner', 'Admin', 'Member', 'Viewer']; // Các vai trò hợp lệ

    // Validate input
    if (!AdminID || !ProjectID || !Identifier || !Role) {
        return res.status(400).json({ error: "AdminID, ProjectID, Identifier, and Role are required!" });
    }

    if (!ObjectId.isValid(AdminID) || !ObjectId.isValid(ProjectID)) {
        return res.status(400).json({ error: "Invalid ID format!" });
    }

    if (!validRoles.includes(Role)) {
        return res.status(400).json({ error: `Invalid role. Allowed roles are: ${validRoles.join(', ')}` });
    }

    try {
        // Tìm thành viên dựa trên Username hoặc Email
        const member = await userCollection.findOne({ $or: [{ Username: Identifier }, { Email: Identifier }] });
        if (!member) {
            return res.status(404).json({ error: "Member not found with the provided Username or Email." });
        }

        const memberId = member._id; // Lấy MemberID từ kết quả truy vấn

        // Lấy thông tin dự án
        const project = await projectsCollection.findOne({ _id: new ObjectId(ProjectID) });
        if (!project) {
            return res.status(404).json({ error: "Project not found." });
        }

        // Lấy danh sách members
        const members = project.Members || [];
        let adminRole = members.find(member => member.MemberID.toString() === AdminID)?.Role;
        const targetMemberRole = members.find(member => member.MemberID.toString() === memberId.toString())?.Role;

        // Kiểm tra quyền của Admin hoặc Creator
        if (project.CreatedBy.toString() === AdminID) {
            adminRole = "Creator";
        } else if (adminRole !== 'Admin') {
            return res.status(403).json({ error: "Only Admin or Creator can update member roles." });
        }

        // Quyền của Admin và Creator
        if (adminRole === 'Admin') {
            if (targetMemberRole === 'Owner') {
                return res.status(403).json({ error: "Admin cannot change or remove the role of the Creator (Owner)." });
            }
            if (targetMemberRole === 'Admin') {
                return res.status(403).json({ error: "Admin cannot change the role of another Admin." });
            }
            if (Role === 'Owner') {
                return res.status(403).json({ error: "Admin cannot assign the Owner role." });
            }
        }

        // Cập nhật vai trò của thành viên
        const result = await projectsCollection.updateOne(
            { _id: new ObjectId(ProjectID), "Members.MemberID": new ObjectId(memberId) },
            { $set: { "Members.$.Role": Role } }
        );

        if (result.matchedCount === 0) {
            return res.status(500).json({ error: "Failed to update member role. The member may not exist in the project." });
        }

        return res.status(200).json({ message: "Member role updated successfully!" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});


app.put('/update_project_status', async (req, res) => {
    const { AdminID, ProjectID, Status } = req.body;

    const validStatuses = ['Ongoing', 'Completed', 'Pending', 'Delayed', 'Canceled']; // Các trạng thái hợp lệ

    // Validate input
    if (!AdminID || !ProjectID || !Status) {
        return res.status(400).json({ error: "AdminID, ProjectID, and Status are required!" });
    }

    if (!ObjectId.isValid(AdminID) || !ObjectId.isValid(ProjectID)) {
        return res.status(400).json({ error: "Invalid ID format!" });
    }

    if (!validStatuses.includes(Status)) {
        return res.status(400).json({ error: `Invalid status. Allowed statuses are: ${validStatuses.join(', ')}` });
    }

    try {
        // Fetch the project
        const project = await projectsCollection.findOne({ _id: new ObjectId(ProjectID) });
        if (!project) {
            return res.status(404).json({ error: "Project not found." });
        }

        // Check if the AdminID is the creator or owner of the project
        let userRole = null;
        if (project.CreatedBy.toString() === AdminID) {
            userRole = "Creator";
        } else {
            const adminInProject = project.Members.find(
                member => member.MemberID.toString() === AdminID && member.Role === "Admin"
            );
            userRole = adminInProject ? "Admin" : null;
        }

        if (!["Creator", "Admin","Owner"].includes(userRole)) {
            return res.status(403).json({ error: "Only the Owner or Admin can update the project status." });
        }

        // Update the status of the project
        const result = await projectsCollection.updateOne(
            { _id: new ObjectId(ProjectID) },
            { $set: { Status: Status } }
        );

        if (result.matchedCount === 0) {
            return res.status(500).json({ error: "Failed to update project status." });
        }

        return res.status(200).json({ message: "Project status updated successfully!" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});



app.delete('/deleteproject', async (req, res) => {
    const { AdminID, ProjectID } = req.body;

    // Validate input
    if (!AdminID || !ProjectID) {
        return res.status(400).json({ error: "AdminID and ProjectID are required!" });
    }

    if (!ObjectId.isValid(AdminID) || !ObjectId.isValid(ProjectID)) {
        return res.status(400).json({ error: "Invalid ID format!" });
    }

    try {
        // Fetch the project
        const project = await projectsCollection.findOne({ _id: new ObjectId(ProjectID) });
        if (!project) {
            return res.status(404).json({ error: "Project not found." });
        }

        // Check if the AdminID is the creator or owner of the project
        let userRole = null;
        if (project.CreatedBy.toString() === AdminID) {
            userRole = "Creator";
        } else {
            const adminInProject = project.Members.find(
                member => member.MemberID.toString() === AdminID && member.Role === "Owner"
            );
            userRole = adminInProject ? "Owner" : null;
        }

        if (!["Creator", "Admin","Owner"].includes(userRole)) {
            return res.status(403).json({ error: "Only the Creator or Owner can delete the project." });
        }

        // Delete the project
        const result = await projectsCollection.deleteOne({ _id: new ObjectId(ProjectID) });
        if (result.deletedCount === 0) {
            return res.status(500).json({ error: "Failed to delete project." });
        }

        // Optionally, delete associated tasks
        await db.collection('tasks').deleteMany({ ProjectID: new ObjectId(ProjectID) });

        return res.status(200).json({ message: "Project deleted successfully!" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// -----------------------------TASK---------------------------------------

app.post('/create_task', async (req, res) => {
    const { ProjectID, Title, Description, AssignedTo, DueDate, AdminID, Status } = req.body;

    const validStatuses = ['Pending', 'Ongoing', 'Completed', 'Delayed', 'Canceled'];

    // Validate input
    if (!ProjectID || !Title || !DueDate || !AdminID) {
        return res.status(400).json({ error: "ProjectID, Title, DueDate, and AdminID are required!" });
    }

    if (!ObjectId.isValid(ProjectID) || !ObjectId.isValid(AdminID)) {
        return res.status(400).json({ error: "Invalid ID format!" });
    }

    if (AssignedTo && !Array.isArray(AssignedTo)) {
        return res.status(400).json({ error: "AssignedTo must be an array of usernames or emails." });
    }

    if (Status && !validStatuses.includes(Status)) {
        return res.status(400).json({
            error: `Invalid status. Allowed statuses are: ${validStatuses.join(', ')}`,
        });
    }

    try {
        const existingTask = await db.collection('tasks').findOne({
            ProjectID: new ObjectId(ProjectID),
            Title: Title,
        });

        if (existingTask) {
            return res.status(409).json({ error: "Task with the same title already exists in this project." });
        }

        const project = await projectsCollection.findOne({ _id: new ObjectId(ProjectID) });
        if (!project) {
            return res.status(404).json({ error: "Project not found." });
        }

        let userRole = null;
        if (project.CreatedBy.toString() === AdminID) {
            userRole = "Creator";
        } else {
            const adminInProject = project.Members.find(
                member => member.MemberID.toString() === AdminID && member.Role === "Admin"
            );
            userRole = adminInProject ? "Admin" : null;
        }

        if (!["Creator", "Admin"].includes(userRole)) {
            return res.status(403).json({ error: "Only the Creator or Admin can create tasks for this project." });
        }

        let assignedToIds = [];
        if (AssignedTo && AssignedTo.length > 0) {
            const users = await userCollection.find({
                $or: [{ Username: { $in: AssignedTo } }, { Email: { $in: AssignedTo } }],
            }).toArray();

            assignedToIds = users.map(user => user._id);

            const invalidUsers = AssignedTo.filter(
                usernameOrEmail => !users.some(user => user.Username === usernameOrEmail || user.Email === usernameOrEmail)
            );

            if (invalidUsers.length > 0) {
                return res.status(400).json({
                    error: "Some usernames or emails in AssignedTo are invalid.",
                    invalidUsers,
                });
            }

            const invalidMembers = assignedToIds.filter(
                userId => !project.Members.some(member => member.MemberID.toString() === userId.toString())
            );

            if (invalidMembers.length > 0) {
                const nonMemberDetails = users
                    .filter(user => invalidMembers.some(nonMemberId => nonMemberId.toString() === user._id.toString()))
                    .map(user => user.Username || user.Email);
                return res.status(400).json({
                    error: "Some users in AssignedTo are not members of the project.",
                    invalidMembers: nonMemberDetails,
                });
            }

            const assignedEmails = users.map(user => user.Email);
            assignedEmails.forEach(emailAddr => {
                console.log(`Assigned email: ${emailAddr}, Task: ${Title}`);
                const body = `:${project.ProjectName}\nNhiệm vụ: ${Title}\nHạn chót: ${DueDate}`;
                sendMessageToEmailServer("ASSIGNTASK", body, emailAddr);
            });
        }

        const task = {
            Title,
            Description: Description || "",
            ProjectID: new ObjectId(ProjectID),
            AssignedTo: assignedToIds,
            DueDate: new Date(DueDate),
            CreateDate: new Date(),
            Status: Status || "Pending",
        };

        const result = await db.collection('tasks').insertOne(task);

        return res.status(201).json({ message: "Task created successfully!", TaskID: result.insertedId });
    } catch (err) {
        console.error("Error creating task:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});




app.put('/assign_task', async (req, res) => {
    const { TaskID, ProjectID, AdminID, AssignedTo } = req.body;

    if (!TaskID || !ProjectID || !AdminID || !AssignedTo) {
        return res.status(400).json({ error: "TaskID, ProjectID, AdminID, and AssignedTo are required!" });
    }

    if (!ObjectId.isValid(TaskID) || !ObjectId.isValid(ProjectID) || !ObjectId.isValid(AdminID)) {
        return res.status(400).json({ error: "Invalid ID format!" });
    }

    if (!Array.isArray(AssignedTo)) {
        return res.status(400).json({ error: "AssignedTo must be an array of usernames or emails." });
    }

    try {
        // Fetch the project
        const project = await projectsCollection.findOne({ _id: new ObjectId(ProjectID) });
        if (!project) {
            return res.status(404).json({ error: "Project not found." });
        }

        // Fetch the task to include its title in the email
        const task = await db.collection('tasks').findOne({ _id: new ObjectId(TaskID), ProjectID: new ObjectId(ProjectID) });
        if (!task) {
            return res.status(404).json({ error: "Task not found in the specified project." });
        }

        // Verify AdminID permissions
        const isAdmin = project.Members.some(
            member => member.MemberID.toString() === AdminID && member.Role === "Admin"
        );

        if (project.CreatedBy.toString() !== AdminID && !isAdmin) {
            return res.status(403).json({ error: "Only the Creator or Admin can assign tasks." });
        }

        // Resolve AssignedTo usernames/emails to IDs
        const users = await userCollection.find({
            $or: [{ Username: { $in: AssignedTo } }, { Email: { $in: AssignedTo } }]
        }).toArray();

        const assignedToIds = users.map(user => user._id);
        const invalidUsers = AssignedTo.filter(
            identifier => !users.some(user => user.Username === identifier || user.Email === identifier)
        );

        if (invalidUsers.length > 0) {
            return res.status(400).json({
                error: "Some usernames or emails in AssignedTo are invalid.",
                invalidUsers
            });
        }

        const nonMembers = assignedToIds.filter(
            userId => !project.Members.some(member => member.MemberID.toString() === userId.toString())
        );

        if (nonMembers.length > 0) {
            const nonMemberDetails = users
                .filter(user => nonMembers.some(nonMemberId => nonMemberId.toString() === user._id.toString()))
                .map(user => user.Username || user.Email);
            return res.status(400).json({
                error: "Some users in AssignedTo are not members of the project.",
                nonMembers: nonMemberDetails
            });
        }

        // Notify assigned users
        const assignedEmails = users.map(user => user.Email);
        assignedEmails.forEach(emailAddr => {
            try {
                const body = `:${project.ProjectName}\nNhiệm vụ: ${task.Title}\nHạn chót: ${task.DueDate.toISOString().split('T')[0]}`;
                sendMessageToEmailServer("ASSIGNTASK", body, emailAddr);
                // console.log(`Email sent to: ${emailAddr}, Task Title: ${task.Title}`);
            } catch (emailError) {
                console.error(`Failed to send email to ${emailAddr}: ${emailError.message}`);
            }
        });

        // Add AssignedTo IDs to the task
        const result = await db.collection('tasks').updateOne(
            { _id: new ObjectId(TaskID), ProjectID: new ObjectId(ProjectID) },
            { $addToSet: { AssignedTo: { $each: assignedToIds } } }
        );

        if (result.matchedCount === 0) {
            return res.status(500).json({ error: "Failed to assign task." });
        }

        return res.status(200).json({ message: "Task assigned successfully!" });
    } catch (err) {
        console.error("Error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});



app.put('/update_task_progress', async (req, res) => {
    const { TaskID, UserID, Progress, Status } = req.body;

    const validStatuses = ['Pending', 'Ongoing', 'Completed', 'Delayed', 'Canceled']; // Các trạng thái hợp lệ

    // Validate input
    if (!TaskID || !UserID || Progress === undefined) {
        return res.status(400).json({ error: "TaskID, UserID, and Progress are required!" });
    }

    if (!ObjectId.isValid(TaskID) || !ObjectId.isValid(UserID)) {
        return res.status(400).json({ error: "Invalid ID format!" });
    }

    if (Progress < 0 || Progress > 100) {
        return res.status(400).json({ error: "Progress must be between 0 and 100." });
    }

    if (Status && !validStatuses.includes(Status)) {
        return res.status(400).json({
            error: `Invalid status. Allowed statuses are: ${validStatuses.join(', ')}`,
        });
    }

    try {
        // Fetch the task
        const task = await db.collection('tasks').findOne({ _id: new ObjectId(TaskID) });
        if (!task) {
            return res.status(404).json({ error: "Task not found." });
        }

        // Check if the user is assigned to the task
        if (!task.AssignedTo.some(userId => userId.toString() === UserID)) {
            return res.status(403).json({ error: "You are not assigned to this task." });
        }

        // Update task progress and optionally status
        const updateFields = { Progress };
        if (Status) {
            updateFields.Status = Status;
        }

        const result = await db.collection('tasks').updateOne(
            { _id: new ObjectId(TaskID) },
            { $set: updateFields }
        );

        if (result.matchedCount === 0) {
            return res.status(500).json({ error: "Failed to update task progress." });
        }

        // Check if all tasks in the project are completed
        const tasks = await db.collection('tasks').find({ ProjectID: task.ProjectID }).toArray();

        if (tasks.every(task => task.Status === "Completed")) {
            // Update the project status to "Complete"
            const projectUpdateResult = await projectsCollection.updateOne(
                { _id: task.ProjectID },
                { $set: { Status: "Complete" } }
            );

            if (projectUpdateResult.modifiedCount > 0) {
                console.log(`Project ${task.ProjectID} status updated to "Complete".`);
            }
        }

        return res.status(200).json({ message: "Task progress updated successfully!" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/list_tasks', async (req, res) => {
    const { ProjectID, UserID } = req.query;

    // Validate required fields
    if (!ProjectID || !UserID) {
        return res.status(400).json({ error: "ProjectID and UserID are required!" });
    }

    // Validate ID formats
    if (!ObjectId.isValid(ProjectID) || !ObjectId.isValid(UserID)) {
        return res.status(400).json({ error: "Invalid ID format!" });
    }

    try {
        // Fetch the project
        const project = await projectsCollection.findOne({ _id: new ObjectId(ProjectID) });
        if (!project) {
            return res.status(404).json({ error: "Project not found." });
        }

        // Check if the user is a member or creator of the project
        const isMember = project.Members.some(
            (member) => member.MemberID.toString() === UserID
        );
        if (!isMember && project.CreatedBy.toString() !== UserID) {
            return res.status(403).json({ error: "Access denied. You are not a member of this project." });
        }

        // Fetch tasks for the project
        const tasksCursor = db.collection('tasks').find({ ProjectID: new ObjectId(ProjectID) });
        const tasks = await tasksCursor.toArray();

        // Resolve AssignedTo (IDs) to Full Names
        const assignedToNames = {};
        for (const task of tasks) {
            if (Array.isArray(task.AssignedTo)) {
                for (const userId of task.AssignedTo) {
                    if (!assignedToNames[userId]) {
                        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
                        if (user) {
                            assignedToNames[userId] = user.Name;
                        } else {
                            assignedToNames[userId] = "Unknown";
                        }
                    }
                }
            }
        }

        // Format tasks with full names for AssignedTo
        const formattedTasks = tasks.map((task) => ({
            ...task,
            _id: task._id.toString(),
            AssignedTo: Array.isArray(task.AssignedTo)
                ? task.AssignedTo.map(userId => ({
                      MemberID: userId.toString(),
                      FullName: assignedToNames[userId] || "Unknown"
                  }))
                : [],
            ProjectID: task.ProjectID.toString(),
            CreateDate: task.CreateDate.toISOString(),
            DueDate: task.DueDate ? task.DueDate.toISOString() : null
        }));

        // Build the response
        return res.status(200).json({ Tasks: formattedTasks });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

const net = require('net');
const crypto = require('crypto'); 

app.post('/ForgetPassword', async (req, res) => {
    const { Email } = req.body;

    if (!Email) {
        return res.status(400).json({ error: "Email is required!" });
    }

    try {
        const user = await userCollection.findOne({ Email });
        if (!user) {
            return res.status(404).json({ error: "Invalid credentials." });
        }

        // Check if OTP attempts exceed limit
        if (user.OTPAttempts >= 5) {
            return res.status(429).json({ error: "Too many attempts. Please try again later." });
        }

        const OTP = crypto.randomInt(100000, 999999).toString();
        await userCollection.updateOne(
            { Email },
            { 
                $set: { OTP, OTPExpiration: new Date(Date.now() + 5 * 60 * 1000) },
                $inc: { OTPAttempts: 1 }
            }
        );
        const tcpResponse = await sendMessageToEmailServer('ForgetPassword',OTP, Email);
        return res.status(200).json({ message: "OTP sent successfully!"});
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error." });
    }
});

const dns = require('dns');
// Function to send a message to the server
function sendMessageToEmailServer(func,body, Email) {
    
    var host = '171.249.230.129'
    var port = 8082;
    return new Promise((resolve, reject) => {
        const client = new net.Socket();

        // Connect to the server
        client.connect(port, host, () => {
            console.log('Connected to server');
            
            // Concatenate the message into a single string with a delimiter
            const message = `${func}|${body}|${Email}`;
            
            // Send the message to the server
            client.write(message);
        });

        // Handle data received from the server
        client.on('data', (data) => {
            console.log(`Received from server: ${data.toString()}`);
            resolve(data.toString());
            client.end(); // Close the connection
        });

        // Handle errors
        client.on('error', (err) => {
            console.error(`Error: ${err.code} - ${err.message}`);
            reject(err);
        });

        // Handle timeout
        client.setTimeout(5000); // Timeout after 5 seconds
        client.on('timeout', () => {
            console.error('Connection timed out');
            reject(new Error('Connection timed out'));
            client.destroy(); // Close the connection
        });

        // Handle connection close
        client.on('close', () => {
            console.log('Connection closed');
        });
    });
}


app.post('/ResetPassword', async (req, res) => {
    const { Identifier, OTP, NewPassword } = req.body;

    if (!Identifier || !OTP || !NewPassword) {
        return res.status(400).json({ error: "All fields are required!" });
    }

    try {
        const user = await userCollection.findOne({
            $or: [{ Email: Identifier }, { Username: Identifier }]
        });

        if (!user) {
            return res.status(404).json({ error: "Invalid credentials." });
        }

        if (user.OTP !== OTP) {
            return res.status(400).json({ error: "Invalid OTP." });
        }

        if (new Date(user.OTPExpiration) < new Date()) {
            return res.status(400).json({ error: "OTP has expired." });
        }

        const hashedPassword = await bcrypt.hash(NewPassword, 10);
        await userCollection.updateOne(
            { _id: user._id },
            { $set: { Password: hashedPassword }, $unset: { OTP: "", OTPExpiration: "", OTPAttempts: "" } }
        );

        return res.status(200).json({ message: "Password updated successfully!" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Internal server error." });
    }
});


const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server đang chạy tại http://0.0.0.0:${PORT}`);
});