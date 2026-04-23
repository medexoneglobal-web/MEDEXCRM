const fs = require("fs");
const path = "c:/Users/N6745/Music/Cloud/crm-system/public/index.html";
let content = fs.readFileSync(path, "utf8");

function replace(oldStr, newStr, label) {
  if (content.includes(oldStr)) {
    content = content.replace(oldStr, newStr);
    console.log(label + " updated");
  } else {
    console.log(label + " NOT found");
  }
}

replace(
`        async function deleteCustomerById(id) {
            if (!hasPermission("crm", "delete")) {
                console.warn("Delete permission denied");
                return;
            }
            if (!id || id === "undefined" || id === "null") {
                console.warn("Cannot delete: record has no database ID");
                return;
            }

            // Find the row in crmData by ID
            const rowIndex = crmData.findIndex(r => String(r.id) === String(id));
            if (rowIndex === -1) {
                console.warn("Record not found in local data");
                return;
            }

            const recordData = { ...crmData[rowIndex] };
            delete recordData.id;

            // Insert audit log before deleting
            try {
                await supabaseClient.from("audit_log").insert([{
                    contacts_id: id,
                    action: "DELETE",
                    changed_by: currentUser ? currentUser.username : "Unknown",
                    old_data: recordData
                }]);
            } catch (auditErr) {
                console.error("Failed to insert audit log for delete:", auditErr);
            }

            try {
                const { error } = await supabaseClient.from("contacts").delete().eq("id", id);
                if (error) {
                    console.error(`Failed to delete record ${id} from Supabase:`, error);
                    return;
                }
            } catch (err) {
                console.error(`Error deleting record ${id}:`, err);
                return;
            }

            // Remove from local data and re-index
            crmData.splice(rowIndex, 1);
            crmData.forEach((row, idx) => {
                row._rowIndex = idx;
            });

            saveCRMData();
            renderTable();
        }`,
`        async function deleteCustomerById(id) {
            if (!hasPermission("crm", "delete")) {
                console.warn("Delete permission denied");
                return;
            }
            if (!id || id === "undefined" || id === "null") {
                console.warn("Cannot delete: record has no database ID");
                return;
            }

            // Find the row in crmData by ID
            const rowIndex = crmData.findIndex(r => String(r.id) === String(id));
            if (rowIndex === -1) {
                console.warn("Record not found in local data");
                return;
            }

            openConfirmModal("Are you sure you want to delete this customer?", async () => {
                const recordData = { ...crmData[rowIndex] };
                delete recordData.id;

                // Insert audit log before deleting
                try {
                    await supabaseClient.from("audit_log").insert([{
                        contacts_id: id,
                        action: "DELETE",
                        changed_by: currentUser ? currentUser.username : "Unknown",
                        old_data: recordData
                    }]);
                } catch (auditErr) {
                    console.error("Failed to insert audit log for delete:", auditErr);
                }

                try {
                    const { error } = await supabaseClient.from("contacts").delete().eq("id", id);
                    if (error) {
                        console.error(`Failed to delete record ${id} from Supabase:`, error);
                        showToast("Failed to delete customer: " + error.message, "error");
                        return;
                    }
                } catch (err) {
                    console.error(`Error deleting record ${id}:`, err);
                    showToast("Failed to delete customer", "error");
                    return;
                }

                // Remove from local data and re-index
                crmData.splice(rowIndex, 1);
                crmData.forEach((row, idx) => {
                    row._rowIndex = idx;
                });

                saveCRMData();
                renderTable();
                showToast("Customer deleted successfully", "success");
            });
        }`,
"deleteCustomerById"
);

fs.writeFileSync(path, content);