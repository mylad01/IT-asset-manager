import React from 'react'; // Imports React

export default function AssetTableControls({ searchTerm, setSearchTerm, filterType, setFilterType }) { // Receives state handlers from parent
  return ( // Returns the UI controls
    <div className="flex gap-4 mb-4"> {/* Container for search and filter controls */}
      <input 
        type="text" 
        placeholder="Search assets..." 
        value={searchTerm} 
        onChange={(e) => setSearchTerm(e.target.value)} // Updates search state in parent
        className="border rounded p-2 flex-grow" 
      />
      <select 
        value={filterType} 
        onChange={(e) => setFilterType(e.target.value)} // Updates filter state in parent
        className="border rounded p-2"
      >
        <option value="All">All Types</option> {/* Default option */}
        <option value="Workstation">Workstation</option> {/* Filter option */}
        <option value="Laptop">Laptop</option> {/* Filter option */}
        <option value="Monitor">Monitor</option> {/* Filter option */}
      </select>
    </div>
  ); // Ends return
} // Closes component