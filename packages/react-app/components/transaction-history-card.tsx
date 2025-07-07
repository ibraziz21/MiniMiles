import React from 'react'

const TransactionHistoryCard = () => {
  return (
    <div className="p-3 mb-4 mx-4 flex justify-between border border-[#07955F4D] font-sterling rounded-3xl bg-white">
        <div className='flex flex-col'>
            <div className='flex'>
                <h3>Earned MiniMiles</h3>
                <p className='text-gray-500 font-light'>.12/05/25</p>
            </div>
            <p className='text-gray-500 font-light'>You have earned 10 MiniMiles</p>
        </div>
      <button className='text-[#238D9D] bg-[#66D5754D] rounded-full px-3'>View</button>
    </div>
  )
}

export default TransactionHistoryCard